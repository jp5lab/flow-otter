import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeCapabilities } from '../../../../src/adapters/nodered/capabilities.js';
import { canonicalJson } from '../../../../src/shared/canonical-json.js';
import type { FlowsJson } from '../../../../src/shared/flows-json.js';

const ID_UNIQUENESS_MODULE = '../../../../src/toolkit/validate/rules/id-uniqueness.js';

const FLOWS: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'Main' },
  { id: 'n1', type: 'inject', z: 'tab1', x: 100, y: 100, wires: [[]] },
] as FlowsJson;

const RUNTIME: RuntimeCapabilities = {
  version: '5.0.0-beta.6',
  capabilities: {
    groupNesting: true,
    junctions: true,
    runtimeStateApi: true,
    linkCallNode: true,
    functionLinkCall: true,
    subflowPerInstanceConfig: true,
    isoTimestampInject: true,
    jsonata2: true,
    functionNodePrefixModules: true,
    globalFunctionTimeout: true,
    adminCorsDefault: false,
    delayBurstMode: true,
    tlsPfx: true,
    tlsEnvVars: true,
    credsAlongsideFlows: true,
    oauthCodeExchange: true,
    httpRequestSni: true,
    esmNodeModules: false,
    nodeDefaultsOverride: true,
    markdownGhAlerts: false,
  },
};

afterEach(() => {
  vi.doUnmock(ID_UNIQUENESS_MODULE);
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('ValidateOptions.runtime', () => {
  it('is passed to validator rule invocation context', async () => {
    let seenRuntime: RuntimeCapabilities | undefined;
    vi.doMock(ID_UNIQUENESS_MODULE, () => ({
      check: (_flows: FlowsJson, context?: { runtime?: RuntimeCapabilities }) => {
        seenRuntime = context?.runtime;
        return [];
      },
    }));
    const { runValidators } = await import('../../../../src/toolkit/validate/index.js');

    runValidators(FLOWS, { runtime: RUNTIME });

    expect(seenRuntime).toBe(RUNTIME);
  });

  it('does not change report bytes when runtime is present but no rule consumes it yet', async () => {
    const { runValidators } = await import('../../../../src/toolkit/validate/index.js');

    expect(canonicalJson(runValidators(FLOWS, { runtime: RUNTIME }))).toBe(
      canonicalJson(runValidators(FLOWS)),
    );
  });
});
