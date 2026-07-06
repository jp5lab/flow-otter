import { describe, expect, it } from 'vitest';

import {
  requirementFor,
  resolveCapabilities,
  type Capability,
  type RuntimeCapabilities,
} from '../../../../../src/adapters/nodered/capabilities.js';
import type { Diagnostic } from '../../../../../src/toolkit/validate/report.js';
import { runValidators } from '../../../../../src/toolkit/validate/index.js';
import { check } from '../../../../../src/toolkit/validate/rules/version-compat.js';

function runtime(version: string): RuntimeCapabilities {
  return { version, capabilities: resolveCapabilities(version) };
}

const FEATURE_FLOW = [
  { id: 'tab1', type: 'tab', label: 'Main' },
  {
    id: 'delay1',
    type: 'delay',
    z: 'tab1',
    x: 100,
    y: 100,
    pauseType: 'burst',
    wires: [[]],
  },
  { id: 'tlsPfx1', type: 'tls-config', certType: 'pfx' },
  { id: 'tlsEnv1', type: 'tls-config', certType: 'env' },
  {
    id: 'fnLib1',
    type: 'function',
    z: 'tab1',
    x: 240,
    y: 100,
    wires: [[]],
    libs: [{ var: 'fs', module: 'node:fs' }],
    func: 'return msg;',
  },
  {
    id: 'fnCall1',
    type: 'function',
    z: 'tab1',
    x: 380,
    y: 100,
    wires: [[]],
    func: 'node.linkcall("target", msg); return msg;',
  },
] as never;

function expectWarning(
  diag: Diagnostic | undefined,
  capability: Capability,
  nodeId: string,
  tabId: string | undefined,
): void {
  expect(diag).toMatchObject({
    severity: 'warning',
    rule: 'version-compat',
    nodeId,
    context: {
      capability,
      requirement: requirementFor(capability),
      runtime_version: '4.0.9',
    },
  });
  if (tabId === undefined) {
    expect(diag?.tabId).toBeUndefined();
  } else {
    expect(diag?.tabId).toBe(tabId);
  }
  expect(diag?.message).toContain(requirementFor(capability));
  expect(diag?.message).toContain("capability '" + capability + "'");
  expect(diag?.message).toContain('target runtime is 4.0.9');
}

describe('version-compat', () => {
  it('is silent when no runtime context is provided', () => {
    expect(check(FEATURE_FLOW)).toEqual([]);
  });

  it('warns for burst delay mode on too-old runtimes', () => {
    const out = check(FEATURE_FLOW, { runtime: runtime('4.0.9') });
    const diag = out.find((d) => d.context?.capability === 'delayBurstMode');

    expectWarning(diag, 'delayBurstMode', 'delay1', 'tab1');
    expect(diag?.context).toMatchObject({ feature: 'delay.pauseType', value: 'burst' });
  });

  it('warns for TLS pfx and env cert modes on too-old runtimes', () => {
    const out = check(FEATURE_FLOW, { runtime: runtime('4.0.9') });

    const pfx = out.find((d) => d.context?.capability === 'tlsPfx');
    expectWarning(pfx, 'tlsPfx', 'tlsPfx1', undefined);
    expect(pfx?.context).toMatchObject({ feature: 'tls-config.certType', value: 'pfx' });

    const env = out.find((d) => d.context?.capability === 'tlsEnvVars');
    expectWarning(env, 'tlsEnvVars', 'tlsEnv1', undefined);
    expect(env?.context).toMatchObject({ feature: 'tls-config.certType', value: 'env' });
  });

  it('warns for function libs using node: module prefixes on too-old runtimes', () => {
    const out = check(FEATURE_FLOW, { runtime: runtime('4.0.9') });
    const diag = out.find((d) => d.context?.capability === 'functionNodePrefixModules');

    expectWarning(diag, 'functionNodePrefixModules', 'fnLib1', 'tab1');
    expect(diag?.context).toMatchObject({
      feature: 'function.libs.module',
      module: 'node:fs',
    });
  });

  it('warns for function node.linkcall calls on too-old runtimes', () => {
    const out = check(FEATURE_FLOW, { runtime: runtime('4.0.9') });
    const diag = out.find((d) => d.context?.capability === 'functionLinkCall');

    expectWarning(diag, 'functionLinkCall', 'fnCall1', 'tab1');
    expect(diag?.context).toMatchObject({
      feature: 'function.node.linkcall',
      call: 'node.linkcall',
    });
  });

  it('is silent for features supported by a new runtime', () => {
    expect(check(FEATURE_FLOW, { runtime: runtime('5.0.0') })).toEqual([]);
  });

  it('gates node: function libs at Node-RED 4.1.0', () => {
    const flows = [
      { id: 'tab1', type: 'tab', label: 'Main' },
      {
        id: 'fnLib1',
        type: 'function',
        z: 'tab1',
        x: 100,
        y: 100,
        wires: [[]],
        libs: [{ var: 'fs', module: 'node:fs' }],
        func: 'return msg;',
      },
    ] as never;

    expect(
      check(flows, { runtime: runtime('4.0.9') }).some(
        (d) => d.context?.capability === 'functionNodePrefixModules',
      ),
    ).toBe(true);
    expect(check(flows, { runtime: runtime('4.1.0') })).toEqual([]);
  });

  it('ignores unsupported shapes and syntax handled by other rules', () => {
    const flows = [
      { id: 'tab1', type: 'tab', label: 'Main' },
      { id: 'tlsBlank', type: 'tls-config', certType: '' },
      { id: 'tlsFile', type: 'tls-config', certType: 'file' },
      {
        id: 'fnBroken',
        type: 'function',
        z: 'tab1',
        x: 100,
        y: 100,
        wires: [[]],
        func: 'for (let i = ; i < 10) { node.linkcall("x", msg); }',
      },
      {
        id: 'fnLibClean',
        type: 'function',
        z: 'tab1',
        x: 240,
        y: 100,
        wires: [[]],
        libs: [
          { var: 'fs', module: 'fs' },
          { var: 'custom', module: '@scope/pkg' },
          { var: 'bad', module: 42 },
        ],
        func: 'const x = node["linkcall"]; return msg;',
      },
    ] as never;

    expect(check(flows, { runtime: runtime('4.0.9') })).toEqual([]);
  });

  it('integrates through runValidators with runtime context', () => {
    const flows = [
      { id: 'tab1', type: 'tab', label: 'Main' },
      {
        id: 'delay1',
        type: 'delay',
        z: 'tab1',
        x: 100,
        y: 100,
        pauseType: 'burst',
        wires: [[]],
      },
    ] as never;

    expect(runValidators(flows).diagnostics.filter((d) => d.rule === 'version-compat')).toEqual([]);
    expect(
      runValidators(flows, { runtime: runtime('4.0.9') }).diagnostics.some(
        (d) => d.rule === 'version-compat' && d.context?.capability === 'delayBurstMode',
      ),
    ).toBe(true);
  });
});
