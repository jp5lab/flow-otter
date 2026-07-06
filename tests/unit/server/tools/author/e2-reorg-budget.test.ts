import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { Tool, ToolContext } from '../../../../../src/server/tools/_tool.js';
import { stageChangesTool } from '../../../../../src/server/tools/author/stage-changes.js';
import type { StageChangesOp } from '../../../../../src/server/tools/author/op-schemas.js';
import { deployStagedChangeTool } from '../../../../../src/server/tools/deploy/deploy-staged-change.js';
import { analyzeFlowTool } from '../../../../../src/server/tools/read/analyze-flow.js';
import { getFlowTool } from '../../../../../src/server/tools/read/get-flow.js';
import { previewFlowDiffTool } from '../../../../../src/server/tools/read/preview-flow-diff.js';
import { validateFlowTool } from '../../../../../src/server/tools/read/validate-flow.js';
import { toolErrorPayload } from '../../../../../src/server/transport/tool-error.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import type { FlowsJson, FlowsJsonNode } from '../../../../../src/shared/flows-json.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const E2_TAB_ID = 'e2spag001';
const E2_FIXTURE_URL = new URL(
  '../../../../fixtures/audit-2026-06-10/e2-flows.json',
  import.meta.url,
);

// budgeted section starts at the first author-tier call and ends at deploy; setup/target/read-discovery calls before it are unbudgeted
const COUNTING_BOUNDARY =
  'budgeted section starts at the first author-tier call and ends at deploy; setup/target/read-discovery calls before it are unbudgeted';

interface E2Fixture {
  flows: FlowsJson;
  rev: string;
}

interface BudgetCounters {
  mcp_calls: number;
  deploy_confirmations: number;
}

class SectionAccount {
  readonly calls: string[] = [];
  readonly counters: BudgetCounters = { mcp_calls: 0, deploy_confirmations: 0 };

  constructor(
    readonly name: string,
    readonly budgeted: boolean,
    readonly boundaryCitation?: string,
  ) {}

  record(toolName: string, input: unknown): void {
    this.calls.push(toolName);
    this.counters.mcp_calls += 1;
    if (toolName === 'deploy_staged_change' && hasTopLevelTrue(input, 'confirm')) {
      this.counters.deploy_confirmations += 1;
    }
  }
}

let ctx: ToolContext;
let staging: StagedStore;
let root: string;

function hasTopLevelTrue(input: unknown, key: string): boolean {
  return (
    typeof input === 'object' && input !== null && (input as Record<string, unknown>)[key] === true
  );
}

function loadE2Fixture(): { fixture: E2Fixture; raw: string } {
  const fixturePath = fileURLToPath(E2_FIXTURE_URL);
  const raw = readFileSync(fixturePath, 'utf8');
  return { fixture: JSON.parse(raw) as E2Fixture, raw };
}

beforeEach(async () => {
  const { fixture } = loadE2Fixture();
  root = await mkdtemp(path.join(tmpdir(), 'e2-reorg-budget-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(fixture.flows), 'utf8');

  const config = loadConfig({
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    RENDER_DIR: path.join(root, 'renders'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit-e2-budget',
    ACTOR_NAME: 'unit-test',
    ENABLE_WRITE_TOOLS: 'true',
    ENABLE_DEPLOY_TOOLS: 'true',
    READ_ONLY_MODE: 'false',
  });
  const logger = createLogger({ level: 'silent' });
  staging = new StagedStore({ dir: config.STAGING_DIR });
  const containerFields = {
    config,
    flowSource: new FileFlowSource({ path: flowsPath }),
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging,
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: (): Date => new Date('2026-06-10T18:36:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-e2-budget',
  };
  ctx = { ...containerFields, enrichAudit: () => undefined, container: containerFields };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function invoke<TInput, TOutput>(
  account: SectionAccount,
  tool: Tool<TInput, TOutput>,
  input: TInput,
): Promise<TOutput> {
  account.record(tool.name, input);
  return tool.handler(input, ctx);
}

function buildE2ReorgOps(): StageChangesOp[] {
  return [
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n01', position: { x: 120, y: 120 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n02', position: { x: 120, y: 220 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n03', position: { x: 300, y: 160 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n04', position: { x: 460, y: 160 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n10', position: { x: 600, y: 300 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n05', position: { x: 740, y: 160 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n12', position: { x: 840, y: 120 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n06', position: { x: 960, y: 120 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n08', position: { x: 1120, y: 120 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n07', position: { x: 960, y: 260 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n09', position: { x: 1260, y: 120 } },
    { op: 'move_node', tab_id: E2_TAB_ID, node_id: 'e2n11', position: { x: 1260, y: 260 } },
    { op: 'update_node', tab_id: E2_TAB_ID, node_id: 'e2n05', label: 'High temp?' },
    {
      op: 'add_group',
      tab_id: E2_TAB_ID,
      key: 'e2-acquire',
      name: 'ACQUIRE',
      node_keys: ['e2n01', 'e2n02'],
      position: { x: 40, y: 60 },
      size: { w: 160, h: 200 },
    },
    {
      op: 'add_group',
      tab_id: E2_TAB_ID,
      key: 'e2-condition',
      name: 'CONDITION',
      node_keys: ['e2n03', 'e2n04', 'e2n10'],
      position: { x: 220, y: 100 },
      size: { w: 420, h: 240 },
    },
    {
      op: 'add_group',
      tab_id: E2_TAB_ID,
      key: 'e2-decide',
      name: 'DECIDE',
      node_keys: ['e2n05', 'e2n12'],
      position: { x: 660, y: 60 },
      size: { w: 220, h: 140 },
    },
    {
      op: 'add_group',
      tab_id: E2_TAB_ID,
      key: 'e2-act',
      name: 'ACT',
      node_keys: ['e2n06', 'e2n08', 'e2n07'],
      position: { x: 880, y: 60 },
      size: { w: 320, h: 240 },
    },
    {
      op: 'add_group',
      tab_id: E2_TAB_ID,
      key: 'e2-indicate',
      name: 'INDICATE',
      node_keys: ['e2n09', 'e2n11'],
      position: { x: 1200, y: 60 },
      size: { w: 140, h: 240 },
    },
    {
      op: 'add_comment',
      tab_id: E2_TAB_ID,
      key: 'e2-title',
      text: 'LINE B TEMPERATURE MONITOR  |  acquire -> condition -> decide -> act -> indicate',
      position: { x: 360, y: 40 },
    },
    {
      op: 'add_comment',
      tab_id: E2_TAB_ID,
      key: 'e2-alarm-note',
      text: 'alarm path (>80) - top lane',
      position: { x: 1100, y: 20 },
    },
    {
      op: 'add_comment',
      tab_id: E2_TAB_ID,
      key: 'e2-tap-note',
      text: 'diagnostic tap (smoothed value)',
      position: { x: 620, y: 380 },
    },
  ];
}

function authoringKey(node: FlowsJsonNode): string | undefined {
  const key = (node as Record<string, unknown>)['_authoringKey'];
  return typeof key === 'string' ? key : undefined;
}

function byId(flows: FlowsJson, id: string): FlowsJsonNode {
  const found = flows.find((n) => n.id === id);
  if (found === undefined) throw new Error(`missing node ${id}`);
  return found;
}

function groupByKey(flows: FlowsJson, key: string): FlowsJsonNode {
  const found = flows.find((n) => n.type === 'group' && authoringKey(n) === key);
  if (found === undefined) throw new Error(`missing group ${key}`);
  return found;
}

describe('audit e2 fixture', () => {
  it('is the sterile e2 spaghetti tab only', () => {
    const { fixture, raw } = loadE2Fixture();
    const ids = fixture.flows.map((n) => n.id).sort();

    expect(fixture.flows).toHaveLength(13);
    expect(ids).toEqual(
      [
        E2_TAB_ID,
        'e2n01',
        'e2n02',
        'e2n03',
        'e2n04',
        'e2n05',
        'e2n06',
        'e2n07',
        'e2n08',
        'e2n09',
        'e2n10',
        'e2n11',
        'e2n12',
      ].sort(),
    );
    expect(fixture.flows.some((n) => n.type === 'mqtt-broker')).toBe(false);
    expect(raw).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expect(raw).not.toMatch(
      /(?:https?:\/\/|localhost|mosquitto|mqtt-broker|password|secret|token|api[_-]?key|broker)/i,
    );

    expect(byId(fixture.flows, 'e2n05')).toMatchObject({ type: 'switch', outputs: 2 });
    expect(byId(fixture.flows, 'e2n12')).toMatchObject({ type: 'junction' });
  });
});

describe('F5 e2 reorganization budget', () => {
  it('reorganizes e2 as one stage_changes call within the glossary-counted budget', async () => {
    const setupDiscovery = new SectionAccount('setup/read-discovery', false);
    const before = await invoke(setupDiscovery, getFlowTool, { tab_id: E2_TAB_ID });
    const analysis = await invoke(setupDiscovery, analyzeFlowTool, { tab_id: E2_TAB_ID });
    expect(setupDiscovery.budgeted).toBe(false);
    expect(setupDiscovery.counters.mcp_calls).toBe(2);
    expect(before.nodes).toHaveLength(12);
    expect((analysis.report['counts'] as { groups?: number }).groups).toBe(0);

    const authoring = new SectionAccount('budgeted authoring', true, COUNTING_BOUNDARY);
    const baselineHash = canonicalHash((await ctx.flowSource.load()).flows);
    const staged = await invoke(authoring, stageChangesTool, {
      reason: 'audit e2 one-call reorganization',
      ops: buildE2ReorgOps(),
    });
    expect(staged.based_on_snapshot_hash).toBe(baselineHash);
    expect(staged.op_results).toHaveLength(buildE2ReorgOps().length);
    expect((await staging.read())?.stagedHash).toBe(staged.staged_hash);

    const preview = await invoke(authoring, previewFlowDiffTool, { against: 'staged' });
    expect(preview.summary).toMatchObject({
      nodes_added: 8,
      nodes_removed: 0,
      wires_added: 0,
      wires_removed: 0,
    });

    const deployed = await invoke(authoring, deployStagedChangeTool, {
      staged_hash: staged.staged_hash,
      confirm: true,
    });
    expect(deployed.ok).toBe(true);
    expect(await staging.read()).toBeNull();

    expect(authoring.boundaryCitation).toBe(COUNTING_BOUNDARY);
    expect(authoring.calls).toEqual(['stage_changes', 'preview_flow_diff', 'deploy_staged_change']);
    expect(authoring.counters.mcp_calls).toBeLessThanOrEqual(5);
    expect(authoring.counters.deploy_confirmations).toBe(1);

    const postDeploy = new SectionAccount('post-deploy verification', false);
    const validation = await invoke(postDeploy, validateFlowTool, { tab_id: E2_TAB_ID });
    expect(validation.has_errors).toBe(false);
    expect(validation.warnings).toBe(0);

    const deployedFlows = (await ctx.flowSource.load()).flows;
    const decide = groupByKey(deployedFlows, 'e2-decide') as { id: string; nodes?: string[] };
    const act = groupByKey(deployedFlows, 'e2-act') as { id: string; nodes?: string[] };
    expect(decide.nodes?.sort()).toEqual(['e2n05', 'e2n12']);
    expect(act.nodes?.sort()).toEqual(['e2n06', 'e2n07', 'e2n08']);
    expect(byId(deployedFlows, 'e2n05')).toMatchObject({
      name: 'High temp?',
      outputs: 2,
      x: 740,
      y: 160,
      wires: [['e2n12'], ['e2n07']],
      g: decide.id,
    });
    expect(byId(deployedFlows, 'e2n12')).toMatchObject({
      type: 'junction',
      x: 840,
      y: 120,
      wires: [['e2n06']],
      g: decide.id,
    });
    expect(byId(deployedFlows, 'e2n11')).toMatchObject({ x: 1260, y: 260 });
    expect(
      deployedFlows
        .filter((n) => n.type === 'comment')
        .map((n) => (n as { name?: string }).name)
        .sort(),
    ).toEqual([
      'LINE B TEMPERATURE MONITOR  |  acquire -> condition -> decide -> act -> indicate',
      'alarm path (>80) - top lane',
      'diagnostic tap (smoothed value)',
    ]);
  });

  it('aborts the same batch all-or-nothing when an inserted op fails', async () => {
    const failingOp: StageChangesOp = {
      op: 'add_node',
      tab_id: E2_TAB_ID,
      type: 'switch',
      opts: {
        key: 'bad-switch-rule',
        position: { x: 1400, y: 120 },
        passthrough: { rules: [{ t: 'not-a-switch-rule' }], outputs: 1 },
      },
    };
    const failingIndex = 3;
    const sabotaged = buildE2ReorgOps();
    sabotaged.splice(failingIndex, 0, failingOp);

    const err = await stageChangesTool
      .handler({ reason: 'audit e2 sabotage', ops: sabotaged }, ctx)
      .catch((e: unknown) => e);
    const payload = toolErrorPayload(err).error;

    expect(err).toMatchObject({ name: 'BatchOpError', failedOpIndex: failingIndex });
    expect(payload).toMatchObject({
      name: 'BatchOpError',
      failed_op_index: failingIndex,
      failed_op: failingOp,
    });
    expect(payload.message).toContain('rules.0.t');
    expect(payload.message).toContain('not-a-switch-rule');
    expect(await staging.read()).toBeNull();
    expect((await ctx.flowSource.load()).flows).toEqual(loadE2Fixture().fixture.flows);
  });
});
