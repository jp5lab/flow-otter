import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeCapabilities } from '../../../../src/adapters/nodered/capabilities.js';
import { canonicalJson } from '../../../../src/shared/canonical-json.js';
import type { FlowsJson } from '../../../../src/shared/flows-json.js';

const VALIDATE_MODULE = '../../../../src/toolkit/validate/index.js';

const FLOWS: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'Main' },
  { id: 'n1', type: 'inject', z: 'tab1', x: 100, y: 100, wires: [[]] },
] as FlowsJson;

const RUNTIME: RuntimeCapabilities = {
  version: '4.1.10',
  capabilities: {
    groupNesting: true,
    junctions: true,
    runtimeStateApi: true,
    linkCallNode: true,
    functionLinkCall: false,
    subflowPerInstanceConfig: true,
    isoTimestampInject: true,
    jsonata2: true,
    functionNodePrefixModules: true,
    globalFunctionTimeout: true,
    adminCorsDefault: true,
    delayBurstMode: false,
    tlsPfx: false,
    tlsEnvVars: false,
    credsAlongsideFlows: false,
    oauthCodeExchange: false,
    httpRequestSni: false,
    esmNodeModules: false,
    nodeDefaultsOverride: true,
    markdownGhAlerts: false,
  },
};

afterEach(() => {
  vi.doUnmock(VALIDATE_MODULE);
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('LintOptions.runtime', () => {
  it('is forwarded into runValidators', async () => {
    let seenRuntime: RuntimeCapabilities | undefined;
    vi.doMock(VALIDATE_MODULE, () => ({
      runValidators: (_flows: FlowsJson, opts?: { runtime?: RuntimeCapabilities }) => {
        seenRuntime = opts?.runtime;
        return { diagnostics: [], errors: [], warnings: [], hasErrors: false };
      },
    }));
    const { lintFlows } = await import('../../../../src/toolkit/lint/flows-lint.js');

    lintFlows(FLOWS, { runtime: RUNTIME });

    expect(seenRuntime).toBe(RUNTIME);
  });

  it('does not change lint report bytes when runtime is present but no lint rule consumes it yet', async () => {
    const { lintFlows } = await import('../../../../src/toolkit/lint/flows-lint.js');

    expect(canonicalJson(lintFlows(FLOWS, { layout: true, runtime: RUNTIME }))).toBe(
      canonicalJson(lintFlows(FLOWS, { layout: true })),
    );
  });
});
