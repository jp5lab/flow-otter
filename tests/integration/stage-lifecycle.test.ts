/**
 * Integration coverage for the staging lifecycle hardening (eval campaign
 * 2026-06-10): author tools refuse to stage over an undeployed change, and
 * discard_staged_change is the escape hatch — exercised against a real
 * Node-RED runtime, not a mock.
 */
import { readFile } from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FIXTURE_TAB_ID } from './global-setup.js';
import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;

beforeAll(async () => {
  rig = await buildIntegrationRig();
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

interface StageResult {
  ok: boolean;
  staged_hash: string;
}
interface DiscardResult {
  ok: boolean;
  discarded: boolean;
  staged_hash: string | null;
}

describe('staging lifecycle against live runtime', () => {
  it('refuses to stage a second op over an undeployed stage, then discard unblocks it', async () => {
    const first = (await callTool(rig.registry, rig.container, 'add_comment', {
      tab_id: FIXTURE_TAB_ID,
      text: 'first stage',
    })) as StageResult;
    expect(first.ok).toBe(true);

    // Second author call must refuse rather than silently discard the first.
    await expect(
      callTool(rig.registry, rig.container, 'add_comment', {
        tab_id: FIXTURE_TAB_ID,
        text: 'second stage',
      }),
    ).rejects.toThrow(/pending deploy.*discard_staged_change/s);

    // The first stage is intact.
    const stillStaged = await rig.container.staging.read();
    expect(stillStaged?.stagedHash).toBe(first.staged_hash);

    // Discard clears it.
    const discarded = (await callTool(rig.registry, rig.container, 'discard_staged_change', {
      staged_hash: first.staged_hash,
    })) as DiscardResult;
    expect(discarded.discarded).toBe(true);
    expect(discarded.staged_hash).toBe(first.staged_hash);
    expect(await rig.container.staging.read()).toBeNull();

    // A fresh op now stages successfully.
    const second = (await callTool(rig.registry, rig.container, 'add_comment', {
      tab_id: FIXTURE_TAB_ID,
      text: 'second stage',
    })) as StageResult;
    expect(second.ok).toBe(true);
    await rig.container.staging.clear();
  });

  it('discard_staged_change with nothing staged is a no-op', async () => {
    const out = (await callTool(
      rig.registry,
      rig.container,
      'discard_staged_change',
      {},
    )) as DiscardResult;
    expect(out.ok).toBe(true);
    expect(out.discarded).toBe(false);
    expect(out.staged_hash).toBeNull();
  });

  it('generic add_node materializes schema defaults that survive a real deploy', async () => {
    // inject with NO passthrough: the schema default must materialize `repeat`
    // (Node-RED rejects/ignores an inject without it) and survive POST→GET.
    const staged = (await callTool(rig.registry, rig.container, 'add_node', {
      tab_id: FIXTURE_TAB_ID,
      type: 'inject',
      opts: { label: 'defaults-probe', position: { x: 140, y: 360 } },
    })) as StageResult & { added_node_id?: string; type_had_schema?: boolean };
    expect(staged.ok).toBe(true);
    expect(staged.type_had_schema).toBe(true);

    const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: staged.staged_hash,
      confirm: true,
    })) as { ok: boolean };
    expect(deployed.ok).toBe(true);

    const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
    const res = await fetch(`${baseUrl}/flows`, { headers: { Accept: 'application/json' } });
    const flows = (await res.json()) as Array<Record<string, unknown>>;
    const node = flows.find((n) => n['id'] === staged.added_node_id);
    expect(node).toBeDefined();
    expect(node?.['repeat']).toBe('');
    expect(node?.['payloadType']).toBe('date');

    await callTool(rig.registry, rig.container, 'rollback_last_change', {});
  });
});
