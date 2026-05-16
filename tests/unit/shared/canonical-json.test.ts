import { describe, expect, it } from 'vitest';

import { canonicalJson, canonicalize } from '../../../src/shared/canonical-json.js';

describe('canonical-json', () => {
  it('sorts object keys lexicographically at every depth', () => {
    const a = canonicalJson({ b: 1, a: 2, c: { z: 1, a: 2 } });
    const b = canonicalJson({ a: 2, b: 1, c: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    const out = canonicalJson([3, 1, 2]);
    expect(out).toBe('[\n    3,\n    1,\n    2\n]');
  });

  it('uses 4-space indent', () => {
    const out = canonicalJson({ a: 1 });
    expect(out).toContain('\n    "a": 1');
  });

  it('canonicalize round-trips through JSON without losing data', () => {
    const input = { z: [3, 2, 1], a: { c: false, b: 'x' } };
    const back = canonicalize(input);
    expect(back).toEqual(input);
  });

  it('byte-identical for equivalent inputs with key reordering', () => {
    const a = canonicalJson({ z: 1, a: { y: 2, x: 3 }, m: [1, 2] });
    const b = canonicalJson({ a: { x: 3, y: 2 }, m: [1, 2], z: 1 });
    expect(a).toBe(b);
  });
});
