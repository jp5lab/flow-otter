import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/function-syntax.js';

const FIXTURE = path.join(__dirname, '../../../../fixtures/broken/function-syntax.flows.json');

describe('function-syntax', () => {
  it('passes for valid function code', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'A' },
        {
          id: 'fn1',
          type: 'function',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          func: 'return msg;',
        },
      ] as never),
    ).toEqual([]);
  });

  it('passes when func is empty or missing', () => {
    expect(
      check([
        {
          id: 'fn1',
          type: 'function',
          z: 't',
          x: 0,
          y: 0,
          wires: [[]],
          func: '',
        },
      ] as never),
    ).toEqual([]);
  });

  it('flags invalid syntax in fixture', async () => {
    const flows = JSON.parse(await readFile(FIXTURE, 'utf8')) as never;
    const out = check(flows);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.rule).toBe('function-syntax');
    expect(out[0]?.nodeId).toBe('fn1aaaaaaaaaaaaaa');
    expect(out[0]?.context?.line).toBeGreaterThan(0);
  });
});
