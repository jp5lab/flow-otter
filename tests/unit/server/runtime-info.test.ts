import { describe, expect, it } from 'vitest';

import { clearRuntimeInfo, getOrProbeRuntimeInfo } from '../../../src/server/runtime-info.js';
import type { Container } from '../../../src/server/container.js';

// Container is a wide bag of fields; tests only need to populate the slots
// each test actually exercises. Cast through `unknown` to skip the strict
// `exactOptionalPropertyTypes` constraint that fails when assigning
// `T | undefined` to an optional T.
function fakeContainer(overrides: Record<string, unknown> = {}): Container {
  return overrides as unknown as Container;
}

describe('getOrProbeRuntimeInfo', () => {
  it('returns undefined when there is no admin-api client', async () => {
    const container = fakeContainer({});
    const result = await getOrProbeRuntimeInfo(container);
    expect(result.info).toBeUndefined();
    expect(result.warning).toBeUndefined();
  });

  it('returns cached info without probing', async () => {
    const container = fakeContainer({
      noderedClient: {
        getNoderedVersion: () => {
          throw new Error('probe should not have been called');
        },
      } as unknown as NonNullable<Container['noderedClient']>,
      runtimeInfo: {
        name: 'node-red',
        version: '4.1.10',
        is_prerelease: false,
        detected_at: '2026-05-01T00:00:00.000Z',
        capabilities: { groupNesting: true } as Record<string, boolean>,
      },
    });

    const result = await getOrProbeRuntimeInfo(container);
    expect(result.info?.version).toBe('4.1.10');
    expect(result.warning).toBeUndefined();
  });

  it('probes the client when no cache present and caches the result', async () => {
    let probeCount = 0;
    const fakeClient = {
      getNoderedVersion: () => {
        probeCount++;
        return Promise.resolve({ version: '5.0.0-beta.6', nodeJsVersion: '22.9.0' });
      },
    };
    const container = fakeContainer({
      noderedClient: fakeClient as unknown as Container['noderedClient'],
    });
    const clock = (): Date => new Date('2026-05-19T12:00:00.000Z');

    const first = await getOrProbeRuntimeInfo(container, clock);
    expect(first.info?.version).toBe('5.0.0-beta.6');
    expect(first.info?.is_prerelease).toBe(true);
    expect(first.info?.node_js_version).toBe('22.9.0');
    expect(first.info?.capabilities['functionLinkCall']).toBe(true);
    expect(first.info?.capabilities['adminCorsDefault']).toBe(false);
    expect(probeCount).toBe(1);

    const second = await getOrProbeRuntimeInfo(container, clock);
    expect(second.info?.version).toBe('5.0.0-beta.6');
    expect(probeCount).toBe(1); // cached, not re-probed
  });

  it('captures settings nodeDefaults only when the runtime supports nodeDefaultsOverride', async () => {
    const fakeClient = {
      getNoderedVersion: () =>
        Promise.resolve({
          version: '4.1.10',
          nodeDefaults: { inject: { repeat: '30', once: true } },
        }),
    };
    const container = fakeContainer({
      noderedClient: fakeClient as unknown as Container['noderedClient'],
    });

    const result = await getOrProbeRuntimeInfo(container);

    expect(result.info?.capabilities.nodeDefaultsOverride).toBe(true);
    expect(result.info?.node_defaults).toEqual({ inject: { repeat: '30', once: true } });
  });

  it('ignores settings nodeDefaults when the runtime lacks nodeDefaultsOverride', async () => {
    const fakeClient = {
      getNoderedVersion: () =>
        Promise.resolve({
          version: '4.1.8',
          nodeDefaults: { inject: { repeat: '30' } },
        }),
    };
    const container = fakeContainer({
      noderedClient: fakeClient as unknown as Container['noderedClient'],
    });

    const result = await getOrProbeRuntimeInfo(container);

    expect(result.info?.capabilities.nodeDefaultsOverride).toBe(false);
    expect(result.info?.node_defaults).toBeUndefined();
  });

  it('returns a warning when probe fails (no exception bubbled)', async () => {
    const container = fakeContainer({
      noderedClient: {
        getNoderedVersion: () => Promise.reject(new Error('connect refused')),
      } as unknown as NonNullable<Container['noderedClient']>,
    });

    const result = await getOrProbeRuntimeInfo(container);
    expect(result.info).toBeUndefined();
    expect(result.warning?.code).toBe('version-probe-failed');
    expect(result.warning?.message).toContain('connect refused');
  });

  it('clearRuntimeInfo wipes the cache', async () => {
    let probeCount = 0;
    const fakeClient = {
      getNoderedVersion: () => {
        probeCount++;
        return Promise.resolve({ version: '4.1.10' });
      },
    };
    const container = fakeContainer({
      noderedClient: fakeClient as unknown as Container['noderedClient'],
    });

    await getOrProbeRuntimeInfo(container);
    expect(probeCount).toBe(1);

    clearRuntimeInfo(container);
    await getOrProbeRuntimeInfo(container);
    expect(probeCount).toBe(2);
  });
});
