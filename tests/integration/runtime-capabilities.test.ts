import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  parseSemVer,
  requirementFor,
  resolveCapabilities,
  satisfiesRange,
  type Capability,
  type RuntimeInfo,
} from '../../src/adapters/nodered/capabilities.js';
import { getOrProbeRuntimeInfo } from '../../src/server/runtime-info.js';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;

const SELECTED_VERSION_GATES = [
  'functionNodePrefixModules',
  'globalFunctionTimeout',
  'nodeDefaultsOverride',
  'functionLinkCall',
  'adminCorsDefault',
  'delayBurstMode',
  'tlsEnvVars',
  'esmNodeModules',
  'markdownGhAlerts',
] as const satisfies readonly Capability[];

interface HealthCheckOutput {
  ok: boolean;
  flow_source_reachable: boolean;
  runtime?: RuntimeInfo;
}

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

afterAll(async () => {
  await rig.cleanup();
});

describe('runtime capability detection against live Node-RED', () => {
  it('reports a version-correct capability matrix for the active 4.1 or 5.0 leg', async () => {
    const directVersion = await rig.container.noderedClient?.getNoderedVersion();
    if (directVersion === undefined) {
      throw new Error('Integration rig did not create a Node-RED admin-api client.');
    }

    const probe = await getOrProbeRuntimeInfo(rig.container);
    expect(probe.warning).toBeUndefined();
    if (probe.info === undefined) {
      throw new Error('Runtime info probe did not return Node-RED runtime metadata.');
    }

    const info = probe.info;
    expect(info.version).toBe(directVersion.version);

    const parsed = parseSemVer(info.version);
    if (parsed === null) {
      throw new Error(`Node-RED version did not parse as SemVer: ${info.version}`);
    }
    expect(satisfiesRange(info.version, '>=4.0.0')).toBe(true);

    const expectedCapabilities = resolveCapabilities(info.version);
    expect(info.capabilities).toEqual(expectedCapabilities);

    for (const cap of SELECTED_VERSION_GATES) {
      expect(info.capabilities[cap]).toBe(satisfiesRange(info.version, requirementFor(cap)));
    }

    const health = (await callTool(
      rig.registry,
      rig.container,
      'health_check',
      {},
    )) as HealthCheckOutput;
    expect(health.ok).toBe(true);
    expect(health.flow_source_reachable).toBe(true);
    expect(health.runtime).toBeDefined();
    expect(health.runtime?.version).toBe(info.version);
    expect(health.runtime?.capabilities).toEqual(info.capabilities);
  });
});
