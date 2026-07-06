/**
 * LAYO-6 live coverage for the opt-in layout_flow tool. Requires the sterile
 * Node-RED stack; do not run in the no-network sandbox.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type FlowsJson } from '../../src/shared/flows-json.js';
import { diffFlows } from '../../src/toolkit/diff/semantic.js';
import { stripLayoutGeometry } from '../../src/toolkit/layout/index.js';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

const TAB_ID = 'layo6tab';
const FIXTURE: FlowsJson = [
  { id: TAB_ID, type: 'tab', label: 'LAYO-6', _authoringKey: 'layout-tab' },
  {
    id: 'layo6source',
    type: 'inject',
    z: TAB_ID,
    x: 520,
    y: 300,
    wires: [['layo6worker']],
    name: 'Source',
    g: 'layo6group',
    props: [],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: '',
    payloadType: 'date',
    _authoringKey: 'source',
  },
  {
    id: 'layo6worker',
    type: 'function',
    z: TAB_ID,
    x: 80,
    y: 500,
    wires: [['layo6target']],
    name: 'Worker',
    g: 'layo6group',
    func: 'return msg;',
    outputs: 1,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    _authoringKey: 'worker',
  },
  {
    id: 'layo6target',
    type: 'debug',
    z: TAB_ID,
    x: 260,
    y: 80,
    wires: [],
    name: 'Target',
    active: true,
    tosidebar: true,
    console: false,
    complete: 'payload',
    statusVal: '',
    statusType: 'auto',
    _authoringKey: 'target',
  },
  {
    id: 'layo6group',
    type: 'group',
    z: TAB_ID,
    name: 'Processing',
    nodes: ['layo6source', 'layo6worker'],
    x: 40,
    y: 40,
    w: 540,
    h: 360,
    style: {
      stroke: '#a4a4a4',
      'stroke-opacity': '1',
      fill: 'none',
      'fill-opacity': '1',
      label: true,
      'label-position': 'nw',
    },
    _authoringKey: 'processing',
  },
];

function sortById<T extends Record<string, unknown>>(flows: readonly T[]): T[] {
  const idOf = (node: T): string => (typeof node['id'] === 'string' ? node['id'] : '');
  return [...flows].sort((a, b) => idOf(a).localeCompare(idOf(b)));
}

/**
 * The staging pipeline stamps `_authoringKey` (= id) on nodes that lacked one
 * — standard compile enrichment for every author tool, not layout geometry.
 * Drop it so the comparison pins geometry-only semantics.
 */
function stripAuthoringKeys(flows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return flows.map((node) => {
    const rest = { ...node };
    delete rest['_authoringKey'];
    return rest;
  });
}

interface LayoutFlowResult {
  ok: boolean;
  staged_hash: string;
  diff_summary: {
    nodes_added: number;
    nodes_removed: number;
    nodes_modified: number;
    wires_added: number;
    wires_removed: number;
  };
  dry_run: boolean;
  staged: boolean;
}

let rig: TestRig;

beforeAll(async () => {
  rig = await buildIntegrationRig();
  rig.registry.enableToolset('layout');
});

const STANDARD_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/inject-to-debug.flows.json',
);

async function deployFull(flows: FlowsJson): Promise<void> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: JSON.stringify(flows),
  });
  if (!res.ok) throw new Error(`reseed failed: ${res.status}`);
}

async function standardFixture(): Promise<FlowsJson> {
  return JSON.parse(await readFile(STANDARD_FIXTURE_PATH, 'utf8')) as FlowsJson;
}

let priorFlows: FlowsJson;

beforeEach(async () => {
  // Deploy the standard fixture PLUS the LAYO-6 tab: later test files
  // (eval-driver) assume the standard seed tab survives, so a full deploy of
  // only the LAYO-6 tab would break suite-order-dependent state.
  await deployFull([...(await standardFixture()), ...FIXTURE]);
  await rig.container.staging.clear();
  priorFlows = (await rig.container.flowSource.load()).flows;
});

afterAll(async () => {
  // Restore the standard seed for whichever test file runs next.
  await deployFull(await standardFixture());
  await rig.cleanup();
});

describe('layout_flow against live runtime', () => {
  it('stages one geometry-only layout change and respects the single slot', async () => {
    const out = (await callTool(rig.registry, rig.container, 'layout_flow', {
      tab_id: 'layout-tab',
    })) as LayoutFlowResult;
    expect(out.ok).toBe(true);
    expect(out.staged).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(0);
    expect(out.diff_summary.nodes_removed).toBe(0);
    expect(out.diff_summary.wires_added).toBe(0);
    expect(out.diff_summary.wires_removed).toBe(0);

    const staged = (await rig.container.staging.read())!;
    const diff = diffFlows(priorFlows, staged.flows);
    expect(diff.added.nodes).toEqual([]);
    expect(diff.removed.nodes).toEqual([]);
    expect(diff.added.wires).toEqual([]);
    expect(diff.removed.wires).toEqual([]);
    // Compile emits canonical object ordering, which may differ from the
    // runtime's — compare id-sorted (the semantic diff above already pins
    // zero adds/removes).
    expect(sortById(stripAuthoringKeys(stripLayoutGeometry(staged.flows)))).toEqual(
      sortById(stripAuthoringKeys(stripLayoutGeometry(priorFlows))),
    );
    // `_authoringKey` is the standard compile enrichment stamped on
    // previously-unkeyed nodes by EVERY author tool — everything else must
    // be geometry.
    const allowedFields = ['x', 'y', 'w', 'h', '_authoringKey'];
    for (const modification of diff.modified.nodes) {
      expect(
        modification.fields.every((field) => allowedFields.includes(field)),
        `unexpected modified fields: ${modification.fields.join(', ')}`,
      ).toBe(true);
    }

    await expect(
      callTool(rig.registry, rig.container, 'layout_flow', { tab_id: 'layout-tab' }),
    ).rejects.toThrow(/pending deploy.*discard_staged_change/s);
    expect((await rig.container.staging.read())?.stagedHash).toBe(out.staged_hash);
  });

  it('deploys then dry-run relayout reports zero diff without staging', async () => {
    const staged = (await callTool(rig.registry, rig.container, 'layout_flow', {
      tab_id: 'layout-tab',
    })) as LayoutFlowResult;

    await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: staged.staged_hash,
      confirm: true,
    });

    const relayout = (await callTool(rig.registry, rig.container, 'layout_flow', {
      tab_id: 'layout-tab',
      dry_run: true,
    })) as LayoutFlowResult;

    expect(relayout.ok).toBe(true);
    expect(relayout.dry_run).toBe(true);
    expect(relayout.staged).toBe(false);
    expect(relayout.diff_summary).toEqual({
      nodes_added: 0,
      nodes_removed: 0,
      nodes_modified: 0,
      wires_added: 0,
      wires_removed: 0,
    });
    expect(await rig.container.staging.read()).toBeNull();
  });
});
