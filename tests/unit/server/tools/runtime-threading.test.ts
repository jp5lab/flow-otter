import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveCapabilities,
  type RuntimeCapabilities,
} from '../../../../src/adapters/nodered/capabilities.js';
import { NoAuth } from '../../../../src/adapters/nodered/auth.js';
import { loadConfig } from '../../../../src/server/config/load.js';
import type { Container } from '../../../../src/server/container.js';
import type { ToolContext } from '../../../../src/server/tools/_tool.js';
import { canonicalJson } from '../../../../src/shared/canonical-json.js';
import { canonicalHash } from '../../../../src/shared/hash.js';
import type { FlowSource } from '../../../../src/shared/flow-source.js';
import type { FlowsJson } from '../../../../src/shared/flows-json.js';
import { createLogger } from '../../../../src/shared/logger.js';
import { compile } from '../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';
import type { LintOptions } from '../../../../src/toolkit/lint/flows-lint.js';

const LINT_MODULE = '../../../../src/toolkit/lint/flows-lint.js';
const VALIDATE_MODULE = '../../../../src/toolkit/validate/index.js';

const READ_FLOWS: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'Main', disabled: false, info: '' },
  { id: 'n1', type: 'inject', z: 'tab1', x: 100, y: 100, wires: [[]] },
] as FlowsJson;

const PRIOR_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tab1',
      label: 'Main',
      nodes: [{ key: 'source', type: 'inject', label: 'Source', position: { x: 100, y: 100 } }],
      connections: [],
      groups: [],
      comments: [],
      junctions: [],
    },
  ],
};
const NEXT_SPEC: AuthoringSpec = {
  tabs: [
    {
      ...PRIOR_SPEC.tabs[0]!,
      comments: [{ key: 'note', text: 'runtime threaded', position: { x: 100, y: 40 } }],
    },
  ],
};
const PRIOR_FLOWS = compile(PRIOR_SPEC).flows;
const PRIOR_HASH = canonicalHash(PRIOR_FLOWS);

function fakeFlowSource(flows: FlowsJson, kind: 'file' | 'adminapi'): FlowSource {
  return {
    load: () => Promise.resolve({ flows, rev: 'rev-1' }),
    save: () => Promise.resolve({ rev: 'rev-2' }),
    fingerprint: () => Promise.resolve({ sha256: canonicalHash(flows), rev: 'rev-1' }),
    describe: () => ({
      kind: kind === 'adminapi' ? 'adminapi' : 'file',
      target: kind === 'adminapi' ? 'http://127.0.0.1:1880' : '/tmp/flows.json',
    }),
    inspectWarnings: () => Promise.resolve([]),
  };
}

function buildCtx(flows: FlowsJson, kind: 'file' | 'adminapi'): ToolContext {
  const config = loadConfig({
    FLOW_SOURCE: kind === 'adminapi' ? 'admin-api' : 'file',
    ...(kind === 'adminapi'
      ? { NODE_RED_BASE_URL: 'http://127.0.0.1:1880' }
      : { FLOW_FILE_PATH: '/tmp/flows.json' }),
    SNAPSHOT_DIR: '/tmp/flow-otter-nr5-snapshots',
    STAGING_DIR: '/tmp/flow-otter-nr5-staging',
    AUDIT_LOG_PATH: '/tmp/flow-otter-nr5-audit.jsonl',
    RENDER_DIR: '/tmp/flow-otter-nr5-renders',
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
  });
  const logger = createLogger({ level: 'silent' });
  const container = {
    config,
    flowSource: fakeFlowSource(flows, kind),
    snapshots: {},
    staging: {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    },
    audit: {},
    auth: new NoAuth(),
    logger,
    clock: () => new Date('2026-05-01T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
    ...(kind === 'adminapi'
      ? {
          noderedClient: {
            getNoderedVersion: () =>
              Promise.resolve({ version: '5.0.0-beta.6', nodeJsVersion: '22.9.0' }),
          } as unknown as NonNullable<Container['noderedClient']>,
        }
      : {}),
  } as unknown as Container;
  return { ...container, enrichAudit: () => undefined, container };
}

afterEach(() => {
  vi.doUnmock(LINT_MODULE);
  vi.doUnmock(VALIDATE_MODULE);
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('runtime capability threading through server tools', () => {
  it('validate_flow passes probed runtime info to lint options for admin-api targets', async () => {
    let seenOpts: LintOptions | undefined;
    vi.doMock(LINT_MODULE, () => ({
      lintFlows: (_flows: FlowsJson, opts: LintOptions) => {
        seenOpts = opts;
        return {
          diagnostics: [],
          errors: [],
          warnings: [],
          hasErrors: false,
          layout: { overall: 1, rules: [] },
        };
      },
    }));
    const { validateFlowTool } = await import('../../../../src/server/tools/read/validate-flow.js');

    await validateFlowTool.handler({ tab_id: 'tab1' }, buildCtx(READ_FLOWS, 'adminapi'));

    expect(seenOpts?.runtime?.version).toBe('5.0.0-beta.6');
    expect(seenOpts?.runtime?.capabilities.functionLinkCall).toBe(true);
    expect(seenOpts?.runtime?.capabilities.adminCorsDefault).toBe(false);
  });

  it('validate_all_flows passes probed runtime info to lint options for admin-api targets', async () => {
    let seenOpts: LintOptions | undefined;
    vi.doMock(LINT_MODULE, () => ({
      lintFlows: (_flows: FlowsJson, opts: LintOptions) => {
        seenOpts = opts;
        return {
          diagnostics: [],
          errors: [],
          warnings: [],
          hasErrors: false,
          layout: { overall: 1, rules: [] },
        };
      },
    }));
    const { validateAllFlowsTool } =
      await import('../../../../src/server/tools/read/validate-all-flows.js');

    await validateAllFlowsTool.handler({}, buildCtx(READ_FLOWS, 'adminapi'));

    expect(seenOpts?.runtime?.version).toBe('5.0.0-beta.6');
    expect(seenOpts?.runtime?.capabilities.functionLinkCall).toBe(true);
  });

  it('file-mode validate_all_flows leaves runtime undefined', async () => {
    let seenOpts: LintOptions | undefined;
    vi.doMock(LINT_MODULE, () => ({
      lintFlows: (_flows: FlowsJson, opts: LintOptions) => {
        seenOpts = opts;
        return {
          diagnostics: [],
          errors: [],
          warnings: [],
          hasErrors: false,
          layout: { overall: 1, rules: [] },
        };
      },
    }));
    const { validateAllFlowsTool } =
      await import('../../../../src/server/tools/read/validate-all-flows.js');

    await validateAllFlowsTool.handler({}, buildCtx(READ_FLOWS, 'file'));

    expect(seenOpts).toBeDefined();
    expect(seenOpts?.runtime).toBeUndefined();
  });

  it('file-mode validate_all_flows output is byte-identical without runtime context', async () => {
    const { validateAllFlowsTool } =
      await import('../../../../src/server/tools/read/validate-all-flows.js');
    const fileCtx = buildCtx(READ_FLOWS, 'file');
    const staleContainer = {
      ...fileCtx.container,
      runtimeInfo: {
        name: 'node-red',
        version: '5.0.0-beta.6',
        is_prerelease: true,
        detected_at: '2026-05-01T00:00:00.000Z',
        capabilities: resolveCapabilities('5.0.0-beta.6'),
      },
    } as Container;
    const staleCtx: ToolContext = {
      ...fileCtx,
      container: staleContainer,
      runtimeInfo: staleContainer.runtimeInfo!,
    };

    expect(canonicalJson(await validateAllFlowsTool.handler({}, staleCtx))).toBe(
      canonicalJson(await validateAllFlowsTool.handler({}, fileCtx)),
    );
  });

  it('compileValidateAndStage passes one probed runtime context to validation and lint', async () => {
    let validateRuntime: RuntimeCapabilities | undefined;
    let lintRuntime: RuntimeCapabilities | undefined;
    vi.doMock(VALIDATE_MODULE, () => ({
      runValidators: (_flows: FlowsJson, opts?: { runtime?: RuntimeCapabilities }) => {
        validateRuntime = opts?.runtime;
        return { diagnostics: [], errors: [], warnings: [], hasErrors: false };
      },
    }));
    vi.doMock(LINT_MODULE, () => ({
      lintFlows: (_flows: FlowsJson, opts: LintOptions) => {
        lintRuntime = opts.runtime;
        return { diagnostics: [], errors: [], warnings: [], hasErrors: false };
      },
    }));
    const { compileValidateAndStage } =
      await import('../../../../src/server/tools/author/_stage-pipeline.js');

    const base = await compileValidateAndStage(
      buildCtx(PRIOR_FLOWS, 'adminapi'),
      { flows: PRIOR_FLOWS, hash: PRIOR_HASH, rev: 'rev-1' },
      NEXT_SPEC,
      { toolName: 'nr5-runtime-threading', dryRun: true },
    );

    expect(base.ok).toBe(true);
    expect(validateRuntime?.version).toBe('5.0.0-beta.6');
    expect(lintRuntime?.version).toBe('5.0.0-beta.6');
    expect(validateRuntime).toBe(lintRuntime);
  });
});
