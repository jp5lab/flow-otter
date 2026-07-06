import { describe, expect, it } from 'vitest';

import {
  allCapabilities,
  parseSemVer,
  type Capability,
} from '../../../src/adapters/nodered/capabilities.js';
import { CORE_NODE_TYPES } from '../../../src/toolkit/catalog/data.js';

describe('catalog capability annotations', () => {
  it('uses only capability keys from the runtime capability matrix', () => {
    const knownCapabilities = new Set<Capability>(allCapabilities());
    const usedCapabilities = CORE_NODE_TYPES.flatMap((entry) => entry.capabilities ?? []);

    expect(usedCapabilities.length).toBeGreaterThan(0);
    for (const cap of usedCapabilities) {
      expect(knownCapabilities, `unknown catalog capability: ${cap}`).toContain(cap);
    }
  });

  it('uses parseable min_node_red_version values', () => {
    for (const entry of CORE_NODE_TYPES) {
      if (entry.min_node_red_version === undefined) continue;

      expect(
        parseSemVer(entry.min_node_red_version),
        `${entry.type} has invalid min_node_red_version`,
      ).not.toBeNull();
    }
  });

  it('pins the 4.x/5.x feature sweep entries', () => {
    const byType = new Map(CORE_NODE_TYPES.map((entry) => [entry.type, entry]));

    expect(byType.get('delay')?.capabilities).toContain('delayBurstMode');
    expect(byType.get('delay')?.notes).toMatch(/burst/i);

    expect(byType.get('function')?.capabilities).toEqual(
      expect.arrayContaining([
        'functionLinkCall',
        'esmNodeModules',
        'functionNodePrefixModules',
        'globalFunctionTimeout',
      ]),
    );

    expect(byType.get('inject')?.capabilities).toContain('isoTimestampInject');
  });
});
