import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

const TAB_ID = '1111111111111111';
const INJECT_ID = '2222222222222222';
const DEBUG_ID = '3333333333333333';

const FLOWS_WITH_DEBUG = [
  { id: TAB_ID, type: 'tab', label: 'Main', disabled: false, info: '' },
  {
    id: INJECT_ID,
    type: 'inject',
    z: TAB_ID,
    x: 100,
    y: 100,
    wires: [[DEBUG_ID]],
    name: 'Tick',
    props: [{ p: 'payload' }],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: 'tick',
    payload: 'hello-from-integration',
    payloadType: 'str',
  },
  {
    id: DEBUG_ID,
    type: 'debug',
    z: TAB_ID,
    x: 320,
    y: 100,
    wires: [],
    name: 'Out',
    active: true,
    tosidebar: true,
    complete: 'true',
    targetType: 'full',
    statusVal: '',
    statusType: 'auto',
  },
];

let rig: TestRig;

interface DebugMsg {
  id?: string;
  z?: string;
  topic?: string;
  msg: string;
  format?: string;
  timestamp?: number;
  received_at: string;
}

interface ToolResult {
  ok: boolean;
  connected: boolean;
  buffer_size: number;
  dropped_count: number;
  last_event_at: string | null;
  messages: DebugMsg[];
}

async function postFlows(baseUrl: string, flows: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Node-RED-Deployment-Type': 'full',
    },
    body: JSON.stringify(flows),
  });
  if (!res.ok) {
    throw new Error(`POST /flows failed: ${res.status} ${await res.text()}`);
  }
}

async function fireInject(baseUrl: string, injectId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/inject/${injectId}`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`POST /inject/${injectId} failed: ${res.status} ${await res.text()}`);
  }
}

async function pollFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollFor: predicate never resolved within ${timeoutMs}ms`);
}

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

beforeEach(async () => {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  await postFlows(baseUrl, FLOWS_WITH_DEBUG);
  // Brief settle so the inject + debug node are wired up in the runtime.
  await new Promise((r) => setTimeout(r, 200));
});

afterAll(async () => {
  rig.container.comms?.dispose();
  await rig.cleanup();
});

describe('get_recent_debug_messages integration', () => {
  it('captures a debug-node frame after firing inject', async () => {
    // First call triggers lazy connect and may return empty.
    const initial = (await callTool(
      rig.registry,
      rig.container,
      'get_recent_debug_messages',
      {},
    )) as ToolResult;
    expect(initial.ok).toBe(true);
    expect(initial.buffer_size).toBeGreaterThan(0);

    // Fire the inject.
    const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
    await fireInject(baseUrl, INJECT_ID);

    // Poll until the comms buffer carries our debug frame.
    await pollFor(async () => {
      const out = (await callTool(
        rig.registry,
        rig.container,
        'get_recent_debug_messages',
        {},
      )) as ToolResult;
      return out.messages.some((m) => m.msg.includes('hello-from-integration'));
    });

    // Final assertion + filter checks.
    const out = (await callTool(rig.registry, rig.container, 'get_recent_debug_messages', {
      node_id: DEBUG_ID,
    })) as ToolResult;
    expect(out.connected).toBe(true);
    expect(out.messages.length).toBeGreaterThan(0);
    for (const m of out.messages) {
      expect(m.id).toBe(DEBUG_ID);
    }
    const found = out.messages.find((m) => m.msg.includes('hello-from-integration'));
    expect(found).toBeDefined();
    expect(found?.z).toBe(TAB_ID);
  });

  it('filters by flow_id and respects limit', async () => {
    const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
    await fireInject(baseUrl, INJECT_ID);
    await fireInject(baseUrl, INJECT_ID);
    await fireInject(baseUrl, INJECT_ID);

    await pollFor(async () => {
      const out = (await callTool(rig.registry, rig.container, 'get_recent_debug_messages', {
        flow_id: TAB_ID,
      })) as ToolResult;
      return out.messages.length >= 3;
    });

    const out = (await callTool(rig.registry, rig.container, 'get_recent_debug_messages', {
      flow_id: TAB_ID,
      limit: 2,
    })) as ToolResult;
    expect(out.messages.length).toBeLessThanOrEqual(2);
    for (const m of out.messages) {
      expect(m.z).toBe(TAB_ID);
    }
  });
});
