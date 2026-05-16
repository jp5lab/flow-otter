import { describe, expect, it } from 'vitest';

import { canonicalHash, sha256Hex } from '../../../src/shared/hash.js';

describe('hash', () => {
  it('sha256Hex returns 64 lowercase hex chars', () => {
    const h = sha256Hex('hello');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonicalHash is stable across key-reordered inputs', () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it('canonicalHash differs when content differs', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});
