/**
 * DESIGN-D1 live coverage for stage_spec + validate_spec. Requires the sterile
 * Node-RED stack; do not run in the no-network sandbox.
 */
import { readFile } from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../src/shared/flows-json.js';
import { canonicalHash } from '../../src/shared/hash.js';

import { FIXTURE_INJECT_ID, FIXTURE_TAB_ID } from './global-setup.js';
import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;

beforeAll(async () => {
  rig = await buildIntegrationRig();
  rig.registry.enableToolset('spec_authoring');
});

beforeEach(async () => {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const raw = await readFile(
    new URL('../fixtures/inject-to-debug.flows.json', import.meta.url),
    'utf8',
  );
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: raw,
  });
  if (!res.ok) throw new Error(`reseed failed: ${res.status}`);
  await rig.container.staging.clear();
});

afterAll(async () => {
  await rig.cleanup();
});

interface SpecResult {
  ok: boolean;
  staged_hash?: string;
  would_stage_hash?: string;
  based_on_snapshot_hash: string;
  diff_summary: {
    nodes_added: number;
    nodes_removed: number;
    nodes_modified: number;
    wires_added: number;
    wires_removed: number;
  };
  layout_report: {
    engine: 'two_level';
    tabs: Array<{ tab_id: string; pinned: string[] }>;
  };
  staged: boolean;
  amended?: boolean;
}

async function fetchRuntimeFlows(): Promise<FlowsJson> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`runtime fetch failed: ${res.status}`);
  const parsed = await res.json();
  return Array.isArray(parsed) ? (parsed as FlowsJson) : (parsed as { flows: FlowsJson }).flows;
}

function specWithDebug(key: string) {
  return {
    tabs: [
      {
        id: FIXTURE_TAB_ID,
        label: 'Main',
        nodes: [
          {
            key: FIXTURE_INJECT_ID,
            type: 'inject',
            label: 'Tick',
            passthrough: {
              props: [],
              repeat: '',
              crontab: '',
              once: false,
              onceDelay: 0.1,
              topic: '',
              payload: '',
              payloadType: 'date',
            },
          },
          { key, type: 'debug', label: key },
        ],
        connections: [{ fromKey: FIXTURE_INJECT_ID, outputPort: 0, toKey: key }],
        groups: [],
        comments: [],
        junctions: [],
      },
    ],
  };
}

describe('spec authoring against live runtime', () => {
  it('stage_spec stages one computed-placement declarative change', async () => {
    const initialHash = canonicalHash(await fetchRuntimeFlows());
    const staged = (await callTool(rig.registry, rig.container, 'stage_spec', {
      spec: specWithDebug('spec-debug'),
    })) as SpecResult;

    expect(staged.ok).toBe(true);
    expect(staged.staged).toBe(true);
    expect(staged.based_on_snapshot_hash).toBe(initialHash);
    expect(staged.diff_summary.nodes_added).toBe(1);
    expect(staged.layout_report.engine).toBe('two_level');
    expect(staged.layout_report.tabs[0]?.pinned).toContain(FIXTURE_INJECT_ID);
    expect((await rig.container.staging.read())?.stagedHash).toBe(staged.staged_hash);
  });

  it('validate_spec reports the would-be diff without touching a pending stage', async () => {
    const first = (await callTool(rig.registry, rig.container, 'stage_spec', {
      spec: specWithDebug('pending-debug'),
    })) as SpecResult;

    const validated = (await callTool(rig.registry, rig.container, 'validate_spec', {
      spec: specWithDebug('validated-debug'),
    })) as SpecResult;

    expect(validated.ok).toBe(true);
    expect(validated.staged).toBe(false);
    expect(validated.would_stage_hash).toBeTruthy();
    expect(validated.diff_summary.nodes_added).toBe(1);
    expect((await rig.container.staging.read())?.stagedHash).toBe(first.staged_hash);
  });
});
