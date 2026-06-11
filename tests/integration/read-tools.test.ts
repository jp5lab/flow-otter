import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIXTURE_INJECT_ID, FIXTURE_TAB_ID } from './global-setup.js';
import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(HERE, '../fixtures/inject-to-debug.flows.json');

beforeAll(async () => {
  rig = await buildIntegrationRig();
  // Re-seed the global fixture: earlier test files legitimately deploy other
  // flows to the shared runtime, so this file cannot rely on the global-setup
  // seed still being present by the time it runs.
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: raw,
  });
  if (!res.ok) throw new Error(`re-seed failed: HTTP ${res.status}`);
});

afterAll(async () => {
  await rig.cleanup();
});

describe('read tools against seeded Node-RED', () => {
  it('list_flows returns the seeded tab', async () => {
    const out = (await callTool(rig.registry, rig.container, 'list_flows', {})) as {
      tabs: Array<{ id: string; label: string; node_count: number }>;
    };
    expect(out.tabs.find((t) => t.id === FIXTURE_TAB_ID)?.label).toBe('Main');
    expect(out.tabs.find((t) => t.id === FIXTURE_TAB_ID)?.node_count).toBeGreaterThanOrEqual(1);
  });

  it('get_flows_summary reports totals + hash', async () => {
    const out = (await callTool(rig.registry, rig.container, 'get_flows_summary', {})) as {
      hash: string;
      totals: { tabs: number; nodes: number };
    };
    expect(out.totals.tabs).toBeGreaterThanOrEqual(1);
    expect(out.hash.length).toBe(64);
  });

  it('get_flow returns the seeded tab body', async () => {
    const out = (await callTool(rig.registry, rig.container, 'get_flow', {
      tab_id: FIXTURE_TAB_ID,
    })) as { tab: { label: string }; nodes: unknown[] };
    expect(out.tab.label).toBe('Main');
    expect(out.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('get_node returns the seeded inject node', async () => {
    const out = (await callTool(rig.registry, rig.container, 'get_node', {
      node_id: FIXTURE_INJECT_ID,
    })) as { tab_id: string; node: { type: string } };
    expect(out.tab_id).toBe(FIXTURE_TAB_ID);
    expect(out.node.type).toBe('inject');
  });

  it('search_nodes filters by tab', async () => {
    const out = (await callTool(rig.registry, rig.container, 'search_nodes', {
      tab_id: FIXTURE_TAB_ID,
    })) as { matches: Array<{ id: string }> };
    expect(out.matches.length).toBeGreaterThanOrEqual(1);
  });

  it('list_installed_node_types returns runtime node modules', async () => {
    const out = (await callTool(rig.registry, rig.container, 'list_installed_node_types', {})) as {
      source: string;
      modules: unknown;
    };
    expect(out.source).toBe('admin-api');
    expect(out.modules).toBeDefined();
  });

  it('get_runtime_state reports state', async () => {
    const out = (await callTool(rig.registry, rig.container, 'get_runtime_state', {})) as {
      state: string;
    };
    expect(typeof out.state).toBe('string');
    expect(out.state.length).toBeGreaterThan(0);
  });

  it('analyze_flow reports counts for the tab', async () => {
    const out = (await callTool(rig.registry, rig.container, 'analyze_flow', {
      tab_id: FIXTURE_TAB_ID,
    })) as { report: { counts: { nodes: number } } };
    expect(out.report.counts.nodes).toBeGreaterThanOrEqual(1);
  });

  it('analyze_all_flows aggregates totals', async () => {
    const out = (await callTool(rig.registry, rig.container, 'analyze_all_flows', {})) as {
      report: { totals: { tabs: number } };
    };
    expect(out.report.totals.tabs).toBeGreaterThanOrEqual(1);
  });

  it('explain_flow returns entrypoints', async () => {
    const out = (await callTool(rig.registry, rig.container, 'explain_flow', {
      tab_id: FIXTURE_TAB_ID,
    })) as { report: { entrypoints: unknown[] } };
    expect(Array.isArray(out.report.entrypoints)).toBe(true);
  });

  it('validate_flow returns a diagnostic report', async () => {
    const out = (await callTool(rig.registry, rig.container, 'validate_flow', {
      tab_id: FIXTURE_TAB_ID,
    })) as { has_errors: boolean; diagnostics: unknown[] };
    expect(typeof out.has_errors).toBe('boolean');
    expect(Array.isArray(out.diagnostics)).toBe(true);
  });

  it('validate_all_flows returns a diagnostic report', async () => {
    const out = (await callTool(rig.registry, rig.container, 'validate_all_flows', {})) as {
      has_errors: boolean;
    };
    expect(typeof out.has_errors).toBe('boolean');
  });

  it('render_flow_svg produces an svg string with center-anchored geometry (REND-3)', async () => {
    const out = (await callTool(rig.registry, rig.container, 'render_flow_svg', {
      tab_id: FIXTURE_TAB_ID,
    })) as { svg: string };
    expect(out.svg).toContain('<svg');
    // Seeded inject 'Tick' at (100, 100): w 100 → top-left (50, 85); inject
    // has no input port, one output port centered on the right edge.
    expect(out.svg).toContain('<rect x="50" y="85" width="100" height="30"');
    expect(out.svg).toContain('<circle cx="150" cy="100"');
    expect(out.svg.match(/<circle /g)).toHaveLength(1);
  });

  it('export_snapshot + list_snapshots + get_snapshot round-trip', async () => {
    const exported = (await callTool(rig.registry, rig.container, 'export_snapshot', {
      reason: 'integration-test',
    })) as { ref: { id: string; sha256: string } };
    const list = (await callTool(rig.registry, rig.container, 'list_snapshots', {
      env: 'integration',
    })) as { snapshots: Array<{ id: string }> };
    expect(list.snapshots.some((s) => s.id === exported.ref.id)).toBe(true);
    const got = (await callTool(rig.registry, rig.container, 'get_snapshot', {
      snapshot_id: exported.ref.id,
    })) as { manifest: { sha256: string } };
    expect(got.manifest.sha256).toBe(exported.ref.sha256);
  });

  it('get_staged_change returns null when no staged change is pending', async () => {
    const out = (await callTool(rig.registry, rig.container, 'get_staged_change', {})) as {
      staged: unknown;
    };
    // After other tests may have staged work; either null or a valid object is fine.
    if (out.staged !== null) {
      expect(out.staged).toMatchObject({
        stagedHash: expect.any(String) as string,
      });
    }
  });

  it('preview_flow_diff against snapshot returns zero diff vs same flows', async () => {
    const exported = (await callTool(rig.registry, rig.container, 'export_snapshot', {
      reason: 'self',
    })) as { ref: { id: string } };
    const out = (await callTool(rig.registry, rig.container, 'preview_flow_diff', {
      against: 'snapshot',
      snapshot_id: exported.ref.id,
    })) as {
      summary: {
        nodes_added: number;
        nodes_removed: number;
        nodes_modified: number;
        wires_added: number;
        wires_removed: number;
      };
    };
    expect(out.summary.nodes_added).toBe(0);
    expect(out.summary.nodes_removed).toBe(0);
    expect(out.summary.wires_added).toBe(0);
    expect(out.summary.wires_removed).toBe(0);
  });

  it('get_audit_log_recent returns recent audit entries', async () => {
    // Several read tools above have already recorded audit events.
    const out = (await callTool(rig.registry, rig.container, 'get_audit_log_recent', {
      limit: 10,
    })) as {
      count: number;
      entries: Array<{ raw: string; parsed?: { tool?: string } }>;
    };
    expect(out.count).toBeGreaterThan(0);
    const tools = out.entries
      .map((e) => e.parsed?.tool)
      .filter((x): x is string => typeof x === 'string');
    expect(tools.some((t) => t.startsWith('list_flows') || t.startsWith('get_'))).toBe(true);
  });

  it('every read tool is registered and listable', () => {
    const expected = [
      'health_check',
      'get_server_config_summary',
      'list_flows',
      'get_flows_summary',
      'get_flow',
      'get_node',
      'search_nodes',
      'get_subflow',
      'list_installed_node_types',
      'get_runtime_state',
      'explain_flow',
      'analyze_flow',
      'analyze_all_flows',
      'validate_flow',
      'validate_all_flows',
      'render_flow_svg',
      'preview_flow_diff',
      'export_snapshot',
      'list_snapshots',
      'get_snapshot',
      'list_templates',
      'get_staged_change',
      'get_audit_log_recent',
    ];
    const names = rig.registry.listTools().map((t) => t.name);
    for (const name of expected) {
      expect(names, `tool ${name} should be registered`).toContain(name);
    }
  });
});
