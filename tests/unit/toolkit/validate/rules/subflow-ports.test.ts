import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/subflow-ports.js';

const FIXTURE = path.join(__dirname, '../../../../fixtures/broken/subflow-ports.flows.json');

describe('subflow-ports', () => {
  it('passes when instance wire count matches def out count', () => {
    expect(
      check([
        {
          id: 'def1',
          type: 'subflow',
          name: 'one-out',
          in: [],
          out: [{ x: 0, y: 0, wires: [] }],
        },
        {
          id: 'inst1',
          type: 'subflow:def1',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
        },
      ] as never),
    ).toEqual([]);
  });

  it('flags mismatched port count in fixture', async () => {
    const flows = JSON.parse(await readFile(FIXTURE, 'utf8')) as never;
    const out = check(flows);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.context?.expectedOut).toBe(2);
    expect(out[0]?.context?.actualOut).toBe(1);
  });

  it('flags missing subflow definition', () => {
    const out = check([
      {
        id: 'inst1',
        type: 'subflow:missing',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [],
      },
    ] as never);
    expect(out.length).toBe(1);
    expect(out[0]?.message).toContain('missing subflow definition');
  });
});
