import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/id-uniqueness.js';

describe('id-uniqueness', () => {
  it('passes when all ids are unique', () => {
    expect(
      check([
        { id: 'a', type: 'tab', label: 'A' },
        { id: 'b', type: 'tab', label: 'B' },
      ] as never),
    ).toEqual([]);
  });

  it('flags duplicate ids', () => {
    const out = check([
      { id: 'a', type: 'tab', label: 'A' },
      { id: 'a', type: 'tab', label: 'A2' },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.nodeId).toBe('a');
  });
});
