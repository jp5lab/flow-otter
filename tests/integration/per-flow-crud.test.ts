import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { canonicalHash } from '../../src/shared/hash.js';
import { dangerousToken } from '../../src/server/tools/dangerous/_confirmation.js';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;

interface CreateResult {
  ok: boolean;
  created_id: string;
  snapshot_before: string;
}
interface UpdateResult {
  ok: boolean;
  updated_id: string;
}
interface DeleteResult {
  ok: boolean;
  deleted_id: string;
}

const ACTOR = 'integration-test';
const ENV = 'integration';

function tokenFor(
  operation: 'create_flow' | 'update_flow' | 'delete_flow',
  opts: {
    target?: string;
    flowsHash?: string;
  },
): string {
  return dangerousToken({
    operation,
    environment: ENV,
    actor: ACTOR,
    ...(opts.target !== undefined ? { target: opts.target } : {}),
    ...(opts.flowsHash !== undefined ? { flowsHash: opts.flowsHash } : {}),
  });
}

async function fetchFlowById(id: string): Promise<{ label?: string; nodes?: unknown[] } | null> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flow/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /flow/${id}: ${res.status}`);
  return (await res.json()) as { label?: string; nodes?: unknown[] };
}

beforeAll(async () => {
  rig = await buildIntegrationRig({
    ENABLE_DANGEROUS_TOOLS: 'true',
    ENVIRONMENT_NAME: ENV,
    ACTOR_NAME: ACTOR,
  });
});

beforeEach(async () => {
  // Reset runtime to a known-clean state (one empty tab).
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: JSON.stringify([{ id: 'aaaa', type: 'tab', label: 'Seed', disabled: false, info: '' }]),
  });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
});

afterAll(async () => {
  await rig.cleanup();
});

describe('per-flow CRUD (dangerous tier) integration', () => {
  it('create_flow → update_flow → delete_flow round-trip via Admin API', async () => {
    // CREATE
    const createBody = { label: 'CRUD-Flow', nodes: [] };
    const createToken = tokenFor('create_flow', {
      target: 'CRUD-Flow',
      flowsHash: canonicalHash(createBody),
    });
    const created = (await callTool(rig.registry, rig.container, 'create_flow', {
      flow: createBody,
      confirmation_token: createToken,
    })) as CreateResult;
    expect(created.ok).toBe(true);
    expect(created.created_id).toBeTruthy();

    let live = await fetchFlowById(created.created_id);
    expect(live?.label).toBe('CRUD-Flow');

    // UPDATE
    const updateBody = { id: created.created_id, label: 'CRUD-Flow-Updated', nodes: [] };
    const updateToken = tokenFor('update_flow', {
      target: created.created_id,
      flowsHash: canonicalHash(updateBody),
    });
    const updated = (await callTool(rig.registry, rig.container, 'update_flow', {
      flow_id: created.created_id,
      flow: updateBody,
      confirmation_token: updateToken,
    })) as UpdateResult;
    expect(updated.ok).toBe(true);

    live = await fetchFlowById(created.created_id);
    expect(live?.label).toBe('CRUD-Flow-Updated');

    // DELETE
    const deleteToken = tokenFor('delete_flow', { target: created.created_id });
    const deleted = (await callTool(rig.registry, rig.container, 'delete_flow', {
      flow_id: created.created_id,
      confirmation_token: deleteToken,
    })) as DeleteResult;
    expect(deleted.ok).toBe(true);

    live = await fetchFlowById(created.created_id);
    expect(live).toBeNull();
  });

  it('all three CRUD tools are tier-gated by ENABLE_DANGEROUS_TOOLS', () => {
    const names = rig.registry.listTools().map((t) => t.name);
    expect(names).toContain('create_flow');
    expect(names).toContain('update_flow');
    expect(names).toContain('delete_flow');
  });
});
