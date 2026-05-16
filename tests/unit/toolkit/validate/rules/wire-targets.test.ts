import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/wire-targets.js';

describe('wire-targets', () => {
  it('passes when all targets exist', () => {
    expect(
      check([
        { id: 'a', type: 'tab', label: 'A' },
        { id: 'n1', type: 'inject', z: 'a', x: 0, y: 0, wires: [['n2']] },
        { id: 'n2', type: 'debug', z: 'a', x: 100, y: 0, wires: [] },
      ] as never),
    ).toEqual([]);
  });

  it('flags wire to missing node', () => {
    const out = check([
      { id: 'a', type: 'tab', label: 'A' },
      { id: 'n1', type: 'inject', z: 'a', x: 0, y: 0, wires: [['ghost']] },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.context?.['targetId']).toBe('ghost');
  });
});
