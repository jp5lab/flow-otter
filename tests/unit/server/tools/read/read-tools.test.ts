import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { analyzeAllFlowsTool } from '../../../../../src/server/tools/read/analyze-all-flows.js';
import { analyzeFlowTool } from '../../../../../src/server/tools/read/analyze-flow.js';
import { explainFlowTool } from '../../../../../src/server/tools/read/explain-flow.js';
import { exportSnapshotTool } from '../../../../../src/server/tools/read/export-snapshot.js';
import { getAuditLogRecentTool } from '../../../../../src/server/tools/read/get-audit-log-recent.js';
import { getFlowTool } from '../../../../../src/server/tools/read/get-flow.js';
import { getFlowsSummaryTool } from '../../../../../src/server/tools/read/get-flows-summary.js';
import { getNodeTool } from '../../../../../src/server/tools/read/get-node.js';
import { getServerConfigSummaryTool } from '../../../../../src/server/tools/read/get-server-config-summary.js';
import { getSnapshotTool } from '../../../../../src/server/tools/read/get-snapshot.js';
import { getStagedChangeTool } from '../../../../../src/server/tools/read/get-staged-change.js';
import { getSubflowTool } from '../../../../../src/server/tools/read/get-subflow.js';
import { healthCheckTool } from '../../../../../src/server/tools/read/health-check.js';
import { listFlowsTool } from '../../../../../src/server/tools/read/list-flows.js';
import { listSnapshotsTool } from '../../../../../src/server/tools/read/list-snapshots.js';
import { listTemplatesTool } from '../../../../../src/server/tools/read/list-templates.js';
import { previewFlowDiffTool } from '../../../../../src/server/tools/read/preview-flow-diff.js';
import { renderFlowSvgTool } from '../../../../../src/server/tools/read/render-flow-svg.js';
import { searchNodesTool } from '../../../../../src/server/tools/read/search-nodes.js';
import { validateAllFlowsTool } from '../../../../../src/server/tools/read/validate-all-flows.js';
import { validateFlowTool } from '../../../../../src/server/tools/read/validate-flow.js';
import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';
import { createLogger } from '../../../../../src/shared/logger.js';

const SAMPLE = [
  { id: 'tab1', type: 'tab', label: 'Main', disabled: false, info: '' },
  {
    id: 'inj1',
    type: 'inject',
    z: 'tab1',
    x: 100,
    y: 100,
    wires: [['dbg1']],
    name: 'Tick',
    props: [],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: '',
    payloadType: 'date',
  },
  { id: 'dbg1', type: 'debug', z: 'tab1', x: 300, y: 100, wires: [], name: 'Out' },
  {
    id: 'subdef1',
    type: 'subflow',
    name: 'Sub',
    in: [],
    out: [{ x: 0, y: 0, wires: [] }],
  },
];

let dir: string;
let ctx: ToolContext;

async function buildCtx(
  env: Record<string, string> = {},
): Promise<{ ctx: ToolContext; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'rt-tools-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(SAMPLE), 'utf8');

  const merged = {
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
    ...env,
  };
  const config = loadConfig(merged);
  const logger = createLogger({ level: 'silent' });
  const flowSource = new FileFlowSource({ path: flowsPath });
  const snapshots = new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR });
  const staging = new StagedStore({ dir: config.STAGING_DIR });
  const audit = new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger });
  const fixedClock = (): Date => new Date('2026-05-01T00:00:00.000Z');

  const containerFields = {
    config,
    flowSource,
    snapshots,
    staging,
    audit,
    auth: new NoAuth(),
    logger,
    clock: fixedClock,
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
  };
  const builtCtx: ToolContext = {
    ...containerFields,
    enrichAudit: () => undefined,
    container: containerFields,
  };
  return {
    ctx: builtCtx,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

let cleanup: () => Promise<void>;

beforeEach(async () => {
  const built = await buildCtx();
  ctx = built.ctx;
  cleanup = built.cleanup;
  dir = ctx.config.SNAPSHOT_DIR;
  void dir;
});

afterEach(async () => {
  await cleanup();
});

describe('read tools (file flow source)', () => {
  it('health_check returns ok=true', async () => {
    const out = (await healthCheckTool.handler({}, ctx)) as {
      ok: boolean;
      rasterizer_available: boolean;
    };
    expect(out.ok).toBe(true);
    // REND-5: @resvg/resvg-js is installed in the dev environment, so the
    // PNG channel must report available (false-path pinned in
    // tests/unit/toolkit/render/png-unavailable.test.ts).
    expect(out.rasterizer_available).toBe(true);
  });

  it('get_server_config_summary returns redacted config', async () => {
    const out = (await getServerConfigSummaryTool.handler({}, ctx)) as {
      config: Record<string, unknown>;
    };
    expect(out.config['ENVIRONMENT_NAME']).toBe('unit');
  });

  it('list_flows returns one tab', async () => {
    const out = (await listFlowsTool.handler({}, ctx)) as {
      tabs: Array<{ id: string; authoring_key: string; node_count: number }>;
    };
    expect(out.tabs).toHaveLength(1);
    expect(out.tabs[0]?.id).toBe('tab1');
    // No _authoringKey on the fixture tab, so authoring_key falls back to id.
    expect(out.tabs[0]?.authoring_key).toBe('tab1');
    expect(out.tabs[0]?.node_count).toBe(2);
  });

  it('list_flows surfaces _authoringKey separately from Node-RED id when present', async () => {
    const localRoot = await mkdtemp(path.join(tmpdir(), 'rt-tagged-'));
    const localFlows = path.join(localRoot, 'flows.json');
    await writeFile(
      localFlows,
      JSON.stringify([{ id: 'nrid1', type: 'tab', label: 'Tagged', _authoringKey: 'tag-key' }]),
      'utf8',
    );
    const localCtx: ToolContext = {
      ...ctx,
      flowSource: new FileFlowSource({ path: localFlows }),
    };
    try {
      const out = (await listFlowsTool.handler({}, localCtx)) as {
        tabs: Array<{ id: string; authoring_key: string }>;
      };
      expect(out.tabs[0]?.id).toBe('nrid1');
      expect(out.tabs[0]?.authoring_key).toBe('tag-key');
    } finally {
      await rm(localRoot, { recursive: true, force: true });
    }
  });

  it('get_flows_summary returns counts and hash', async () => {
    const out = (await getFlowsSummaryTool.handler({}, ctx)) as {
      hash: string;
      totals: { tabs: number; nodes: number; wires: number; subflow_defs: number };
    };
    expect(out.totals.tabs).toBe(1);
    expect(out.totals.nodes).toBe(2);
    expect(out.totals.wires).toBe(1);
    expect(out.totals.subflow_defs).toBe(1);
    expect(out.hash.length).toBe(64);
  });

  it('get_flow returns the tab with its nodes', async () => {
    const out = (await getFlowTool.handler({ tab_id: 'tab1' }, ctx)) as {
      tab: { label: string };
      nodes: Array<Record<string, unknown>>;
    };
    expect(out.tab.label).toBe('Main');
    expect(out.nodes).toHaveLength(2);
  });

  it('get_flow throws on missing tab', async () => {
    await expect(getFlowTool.handler({ tab_id: 'missing' }, ctx)).rejects.toThrow(/not found/);
  });

  it('get_node returns node + tab id', async () => {
    const out = (await getNodeTool.handler({ node_id: 'inj1' }, ctx)) as unknown as {
      tab_id: string;
      node: { type: string };
    };
    expect(out.tab_id).toBe('tab1');
    expect(out.node.type).toBe('inject');
  });

  it('search_nodes filters by type glob', async () => {
    const out = (await searchNodesTool.handler({ type: 'debug' }, ctx)) as {
      matches: Array<{ id: string }>;
    };
    expect(out.matches.map((m) => m.id)).toEqual(['dbg1']);
  });

  it('search_nodes filters by tab id', async () => {
    const out = (await searchNodesTool.handler({ tab_id: 'tab1' }, ctx)) as {
      matches: Array<{ id: string }>;
    };
    expect(out.matches.map((m) => m.id).sort()).toEqual(['dbg1', 'inj1']);
  });

  it('get_subflow returns the def with port counts', async () => {
    const out = (await getSubflowTool.handler({ subflow_id: 'subdef1' }, ctx)) as {
      ports: { in: number; out: number };
      instance_count: number;
    };
    expect(out.ports).toEqual({ in: 0, out: 1 });
    expect(out.instance_count).toBe(0);
  });

  it('list_templates returns the built-in catalog', async () => {
    const out = (await listTemplatesTool.handler({}, ctx)) as {
      templates: Array<{ name: string }>;
    };
    expect(out.templates.map((t) => t.name)).toContain('hello_world');
    expect(out.templates).toHaveLength(27);
  });

  it('validate_flow returns diagnostics for one tab', async () => {
    const out = (await validateFlowTool.handler({ tab_id: 'tab1' }, ctx)) as {
      has_errors: boolean;
      diagnostics: unknown[];
      layout: { overall: number; rules: Array<{ rule: string; offender_count: number }> };
    };
    expect(out.has_errors).toBe(false);
    expect(Array.isArray(out.diagnostics)).toBe(true);
    expect(out.layout.rules).toHaveLength(8);
    expect(out.layout.rules.map((r) => r.rule)).toContain('layout-backward-wires');
  });

  it('validate_all_flows runs across the whole document', async () => {
    const out = (await validateAllFlowsTool.handler({}, ctx)) as {
      has_errors: boolean;
      layout: { overall: number; rules: Array<{ rule: string; offender_count: number }> };
    };
    expect(out.has_errors).toBe(false);
    expect(out.layout.rules).toHaveLength(8);
  });

  it('analyze_flow returns a structural report', async () => {
    const out = (await analyzeFlowTool.handler({ tab_id: 'tab1' }, ctx)) as unknown as {
      report: {
        counts: { nodes: number; wires: number };
        layout: { overall: number; rules: Array<{ rule: string }> };
      };
    };
    expect(out.report.counts.nodes).toBe(2);
    expect(out.report.counts.wires).toBe(1);
    expect(out.report.layout.rules).toHaveLength(8);
  });

  it('analyze_all_flows aggregates totals', async () => {
    const out = (await analyzeAllFlowsTool.handler({}, ctx)) as unknown as {
      report: {
        totals: { tabs: number; nodes: number };
        perTab: Array<{ layout: { overall: number; rules: Array<{ rule: string }> } }>;
      };
    };
    expect(out.report.totals.tabs).toBe(1);
    expect(out.report.totals.nodes).toBe(2);
    expect(out.report.perTab[0]?.layout.rules).toHaveLength(8);
  });

  it('explain_flow returns entrypoints and sinks', async () => {
    const out = (await explainFlowTool.handler({ tab_id: 'tab1' }, ctx)) as unknown as {
      report: { entrypoints: Array<{ id: string }>; sinks: Array<{ id: string }> };
    };
    expect(out.report.entrypoints.map((e) => e.id)).toEqual(['inj1']);
    expect(out.report.sinks.map((s) => s.id)).toEqual(['dbg1']);
  });

  it('render_flow_svg returns a deterministic SVG', async () => {
    const out = (await renderFlowSvgTool.handler({ tab_id: 'tab1' }, ctx)) as { svg: string };
    expect(out.svg.includes('<svg')).toBe(true);
    const second = (await renderFlowSvgTool.handler({ tab_id: 'tab1' }, ctx)) as { svg: string };
    expect(second.svg).toBe(out.svg);
  });

  it('export_snapshot + list_snapshots + get_snapshot round-trip', async () => {
    const exported = (await exportSnapshotTool.handler({ reason: 'test' }, ctx)) as {
      ref: { id: string; sha256: string };
    };
    const list = (await listSnapshotsTool.handler({}, ctx)) as {
      snapshots: Array<{ id: string }>;
    };
    expect(list.snapshots.some((s) => s.id === exported.ref.id)).toBe(true);
    const got = (await getSnapshotTool.handler({ snapshot_id: exported.ref.id }, ctx)) as {
      manifest: { sha256: string };
      flows: unknown[];
    };
    expect(got.manifest.sha256).toBe(exported.ref.sha256);
    expect(got.flows.length).toBe(SAMPLE.length);
  });

  it('get_staged_change returns null when no staged change', async () => {
    const out = (await getStagedChangeTool.handler({}, ctx)) as { staged: unknown };
    expect(out.staged).toBeNull();
  });

  it('preview_flow_diff against staged throws when nothing staged', async () => {
    await expect(previewFlowDiffTool.handler({ against: 'staged' }, ctx)).rejects.toThrow(
      /No staged change/,
    );
  });

  it('preview_flow_diff against snapshot returns zero diff vs same flows', async () => {
    const exported = (await exportSnapshotTool.handler({ reason: 'self' }, ctx)) as {
      ref: { id: string };
    };
    const out = (await previewFlowDiffTool.handler(
      { against: 'snapshot', snapshot_id: exported.ref.id },
      ctx,
    )) as {
      summary: { nodes_added: number; nodes_removed: number; nodes_modified: number };
    };
    expect(out.summary).toEqual({
      nodes_added: 0,
      nodes_removed: 0,
      nodes_modified: 0,
      wires_added: 0,
      wires_removed: 0,
    });
  });

  it('get_audit_log_recent returns an empty list when no audit log yet', async () => {
    const out = (await getAuditLogRecentTool.handler({ limit: 10 }, ctx)) as { count: number };
    expect(out.count).toBe(0);
  });
});
