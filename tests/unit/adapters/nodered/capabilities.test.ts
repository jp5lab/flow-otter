import { describe, expect, it } from 'vitest';

import {
  allCapabilities,
  compareSemVer,
  isPrerelease,
  parseSemVer,
  requirementFor,
  resolveCapabilities,
  satisfiesRange,
  type Capability,
} from '../../../../src/adapters/nodered/capabilities.js';

describe('parseSemVer', () => {
  it.each([
    ['4.1.10', { major: 4, minor: 1, patch: 10, prerelease: '' }],
    ['5.0.0-beta.6', { major: 5, minor: 0, patch: 0, prerelease: 'beta.6' }],
    ['3.0.0', { major: 3, minor: 0, patch: 0, prerelease: '' }],
    ['10.20.30-rc.1', { major: 10, minor: 20, patch: 30, prerelease: 'rc.1' }],
    ['1.0.0+build.123', { major: 1, minor: 0, patch: 0, prerelease: '' }],
  ])('parses %s correctly', (input, expected) => {
    expect(parseSemVer(input)).toEqual(expected);
  });

  it.each([['garbage'], ['1.2'], ['v1.2.3'], ['']])('returns null for %s', (input) => {
    expect(parseSemVer(input)).toBeNull();
  });
});

describe('compareSemVer', () => {
  it('orders major/minor/patch numerically', () => {
    expect(compareSemVer(parseSemVer('4.0.0')!, parseSemVer('3.9.9')!)).toBeGreaterThan(0);
    expect(compareSemVer(parseSemVer('4.0.0')!, parseSemVer('4.0.0')!)).toBe(0);
    expect(compareSemVer(parseSemVer('4.1.10')!, parseSemVer('4.1.9')!)).toBeGreaterThan(0);
  });

  it('treats prerelease as lower precedence than stable', () => {
    expect(compareSemVer(parseSemVer('5.0.0-beta.6')!, parseSemVer('5.0.0')!)).toBeLessThan(0);
    expect(compareSemVer(parseSemVer('5.0.0')!, parseSemVer('5.0.0-beta.6')!)).toBeGreaterThan(0);
  });

  it('orders prerelease tags by their parts', () => {
    expect(
      compareSemVer(parseSemVer('5.0.0-beta.6')!, parseSemVer('5.0.0-beta.5')!),
    ).toBeGreaterThan(0);
    expect(compareSemVer(parseSemVer('5.0.0-beta.1')!, parseSemVer('5.0.0-rc.1')!)).toBeLessThan(0);
    expect(compareSemVer(parseSemVer('5.0.0-alpha')!, parseSemVer('5.0.0-beta')!)).toBeLessThan(0);
  });
});

describe('satisfiesRange', () => {
  it('handles >= ranges', () => {
    expect(satisfiesRange('4.0.0', '>=4.0.0')).toBe(true);
    expect(satisfiesRange('4.1.10', '>=4.0.0')).toBe(true);
    expect(satisfiesRange('3.9.0', '>=4.0.0')).toBe(false);
    expect(satisfiesRange('5.0.0-beta.6', '>=5.0.0-0')).toBe(true);
    expect(satisfiesRange('5.0.0-beta.6', '>=5.0.0')).toBe(false);
  });

  it('handles < ranges', () => {
    expect(satisfiesRange('4.1.10', '<5.0.0')).toBe(true);
    expect(satisfiesRange('5.0.0', '<5.0.0')).toBe(false);
    expect(satisfiesRange('5.0.0-beta.6', '<5.0.0')).toBe(true);
  });

  it('returns false for unparseable input', () => {
    expect(satisfiesRange('garbage', '>=4.0.0')).toBe(false);
    expect(satisfiesRange('4.1.10', '~4.1.0')).toBe(false);
  });
});

describe('resolveCapabilities', () => {
  it('classifies Node-RED 4.1.10 correctly', () => {
    const c = resolveCapabilities('4.1.10');
    expect(c.groupNesting).toBe(true);
    expect(c.junctions).toBe(true);
    expect(c.subflowPerInstanceConfig).toBe(true);
    expect(c.functionNodePrefixModules).toBe(true);
    expect(c.functionLinkCall).toBe(false); // 5.0+
    expect(c.adminCorsDefault).toBe(true); // pre-5.0
  });

  it('classifies Node-RED 5.0.0-beta.6 correctly', () => {
    const c = resolveCapabilities('5.0.0-beta.6');
    expect(c.functionLinkCall).toBe(true);
    expect(c.subflowPerInstanceConfig).toBe(true);
    expect(c.adminCorsDefault).toBe(false); // removed in 5.0
  });

  it('classifies Node-RED 4.0.0 correctly', () => {
    const c = resolveCapabilities('4.0.0');
    expect(c.subflowPerInstanceConfig).toBe(true);
    expect(c.jsonata2).toBe(true);
    expect(c.functionNodePrefixModules).toBe(false); // 4.1+
    expect(c.adminCorsDefault).toBe(true);
  });

  it('returns false for every capability when version unparseable', () => {
    const c = resolveCapabilities('not-a-version');
    for (const cap of allCapabilities()) expect(c[cap]).toBe(false);
  });

  it('every documented requirement is a valid range', () => {
    for (const cap of allCapabilities()) {
      const req = requirementFor(cap);
      expect(req).toMatch(/^(>=|<)\s*\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    }
  });
});

describe('isPrerelease', () => {
  it.each<[string, boolean]>([
    ['4.1.10', false],
    ['5.0.0', false],
    ['5.0.0-beta.6', true],
    ['5.0.0-rc.1', true],
    ['5.0.0-alpha.0', true],
    ['garbage', false],
  ])('isPrerelease(%s) === %s', (input, expected) => {
    expect(isPrerelease(input)).toBe(expected);
  });
});

describe('matrix coverage', () => {
  const knownCapabilities: readonly Capability[] = [
    'groupNesting',
    'junctions',
    'runtimeStateApi',
    'linkCallNode',
    'functionLinkCall',
    'subflowPerInstanceConfig',
    'isoTimestampInject',
    'jsonata2',
    'functionNodePrefixModules',
    'globalFunctionTimeout',
    'adminCorsDefault',
  ];

  it('all capabilities have a requirement string', () => {
    for (const cap of knownCapabilities) {
      expect(requirementFor(cap).length).toBeGreaterThan(0);
    }
  });

  it('allCapabilities() returns exactly the known set', () => {
    expect(new Set(allCapabilities())).toEqual(new Set(knownCapabilities));
  });
});
