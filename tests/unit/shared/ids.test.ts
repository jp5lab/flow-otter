import { describe, expect, it } from 'vitest';

import { generateNodeId, isNodeRedId } from '../../../src/shared/ids.js';

describe('ids', () => {
  it('generateNodeId produces 16-hex from any string', () => {
    const id = generateNodeId('tab1:debug:foo');
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('generateNodeId is deterministic', () => {
    expect(generateNodeId('seed')).toBe(generateNodeId('seed'));
  });

  it('different seeds produce different ids', () => {
    expect(generateNodeId('a')).not.toBe(generateNodeId('b'));
  });

  it('isNodeRedId accepts modern 16-hex form', () => {
    expect(isNodeRedId('abcdef1234567890')).toBe(true);
  });

  it('isNodeRedId accepts legacy dotted form', () => {
    expect(isNodeRedId('f6f2187d.f17ca8')).toBe(true);
  });

  it('isNodeRedId rejects non-hex strings', () => {
    expect(isNodeRedId('not-an-id')).toBe(false);
    expect(isNodeRedId(123)).toBe(false);
  });
});
