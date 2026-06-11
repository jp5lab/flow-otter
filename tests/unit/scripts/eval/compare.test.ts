/**
 * EVAL-1 (pulled forward from EVAL-5) — wiring-map canonicalization +
 * idempotence comparator pins. EVAL-6's Phase-1 canaries and EVAL-5's
 * Phase-2 replay scenarios both consume this module; its semantics are
 * frozen here.
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalFlowsHash,
  canonicalJson,
  compareWiring,
  diffWiringMaps,
  wiringFingerprint,
  wiringMap,
} from '../../../../scripts/eval/compare.mjs';
import { canonicalHash } from '../../../../src/shared/hash.js';
import { canonicalJson as srcCanonicalJson } from '../../../../src/shared/canonical-json.js';

const FLOWS = [
  { id: 'tab1', type: 'tab', label: 'Tab 1' },
  { id: 'n1', type: 'inject', z: 'tab1', x: 100, y: 100, wires: [['n2', 'n3']] },
  { id: 'n2', type: 'switch', z: 'tab1', x: 300, y: 100, wires: [['n3'], []] },
  { id: 'n3', type: 'debug', z: 'tab1', x: 500, y: 100, wires: [] },
  { id: 'l1', type: 'link out', z: 'tab1', x: 500, y: 200, wires: [], links: ['l2', 'l0'] },
  { id: 'cfg1', type: 'mqtt-broker', broker: 'localhost' },
];

describe('wiringMap', () => {
  it('maps node id → wires/links and omits objects with neither (tabs, config nodes)', () => {
    const map = wiringMap(FLOWS);
    expect(Object.keys(map).sort()).toEqual(['l1', 'n1', 'n2', 'n3']);
    expect(map['n1']).toEqual({ wires: [['n2', 'n3']] });
    expect(map['n2']).toEqual({ wires: [['n3'], []] });
    expect(map['tab1']).toBeUndefined();
    expect(map['cfg1']).toBeUndefined();
  });

  it('sorts links membership (order is not semantic) but preserves wires port order (it is)', () => {
    const map = wiringMap(FLOWS);
    expect(map['l1']).toEqual({ wires: [], links: ['l0', 'l2'] });
    expect(map['n2']!.wires).toEqual([['n3'], []]); // port 0 then port 1, untouched
  });

  it('accepts both the array form and the {flows: [...]} envelope', () => {
    expect(wiringMap({ flows: FLOWS, rev: 'abc' })).toEqual(wiringMap(FLOWS));
    expect(() => wiringMap({ not: 'flows' })).toThrow(/expected a flows\.json array/);
  });
});

describe('wiringFingerprint — byte-identity basis', () => {
  it('is invariant under position changes, label edits, and node reorder (pure reorganization)', () => {
    const reorganized = [...FLOWS]
      .reverse()
      .map((n) =>
        'x' in n && 'y' in n && n.y !== undefined ? { ...n, x: n.x + 240, y: n.y + 80 } : n,
      )
      .map((n) => (n.id === 'n3' ? { ...n, name: 'renamed', g: 'group1' } : n));
    expect(wiringFingerprint(reorganized)).toBe(wiringFingerprint(FLOWS));
  });

  it('changes when any wire changes', () => {
    const rewired = FLOWS.map((n) => (n.id === 'n1' ? { ...n, wires: [['n2']] } : n));
    expect(wiringFingerprint(rewired)).not.toBe(wiringFingerprint(FLOWS));
  });
});

describe('diffWiringMaps / compareWiring', () => {
  it('returns [] / identical:true for wiring-equal documents', () => {
    expect(diffWiringMaps(wiringMap(FLOWS), wiringMap(FLOWS))).toEqual([]);
    expect(compareWiring(FLOWS, [...FLOWS].reverse())).toEqual({ identical: true, diffs: [] });
  });

  it('reports changed, removed, and added wiring per node id', () => {
    const after = FLOWS.filter((n) => n.id !== 'l1') // l1 removed
      .map((n) => (n.id === 'n1' ? { ...n, wires: [['n2']] } : n)) // n1 changed
      .concat([{ id: 'n9', type: 'debug', z: 'tab1', x: 1, y: 1, wires: [['n1']] }]); // n9 added
    const { identical, diffs } = compareWiring(FLOWS, after);
    expect(identical).toBe(false);
    expect(diffs.map((d) => d.id).sort()).toEqual(['l1', 'n1', 'n9']);
    const l1 = diffs.find((d) => d.id === 'l1')!;
    expect(l1.after).toBeNull();
    const n9 = diffs.find((d) => d.id === 'n9')!;
    expect(n9.before).toBeNull();
  });
});

describe('canonicalFlowsHash — idempotence comparator', () => {
  it('is byte-equivalent to src/shared canonicalHash (the staging/snapshot hash)', () => {
    for (const doc of [FLOWS, { flows: FLOWS }, {}, [], { b: 1, a: { z: 2, y: [3, 1] } }]) {
      expect(canonicalFlowsHash(doc)).toBe(canonicalHash(doc));
    }
  });

  it('canonicalJson mirrors src/shared/canonical-json byte-for-byte', () => {
    const doc = { b: 1, a: { z: null, y: [3, { c: 1, b: 2 }] }, arr: [2, 1] };
    expect(canonicalJson(doc)).toBe(srcCanonicalJson(doc));
  });

  it('equal for key-reordered documents, different for value changes', () => {
    expect(canonicalFlowsHash({ a: 1, b: 2 })).toBe(canonicalFlowsHash({ b: 2, a: 1 }));
    expect(canonicalFlowsHash({ a: 1 })).not.toBe(canonicalFlowsHash({ a: 2 }));
  });
});
