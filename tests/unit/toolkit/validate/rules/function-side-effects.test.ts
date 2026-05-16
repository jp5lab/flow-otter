import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/function-side-effects.js';

const FIXTURE = path.join(
  __dirname,
  '../../../../fixtures/broken/function-side-effects.flows.json',
);

describe('function-side-effects', () => {
  it('passes for clean function code', () => {
    expect(
      check([
        { id: 'a', type: 'tab', label: 'T' },
        {
          id: 'fn1',
          type: 'function',
          z: 'a',
          x: 0,
          y: 0,
          wires: [[]],
          func: 'msg.payload = msg.payload * 2; return msg;',
        },
      ] as never),
    ).toEqual([]);
  });

  it('flags setInterval and process.exit in fixture', async () => {
    const flows = JSON.parse(await readFile(FIXTURE, 'utf8')) as never;
    const out = check(flows);
    const kinds = out.map((d) => d.context?.kind as string);
    expect(kinds).toContain('timer');
    expect(kinds).toContain('process-exit');
    for (const d of out) expect(d.severity).toBe('warning');
  });

  it('flags require("http")', () => {
    const out = check([
      { id: 'a', type: 'tab', label: 'T' },
      {
        id: 'fn1',
        type: 'function',
        z: 'a',
        x: 0,
        y: 0,
        wires: [[]],
        func: "const http = require('http'); return msg;",
      },
    ] as never);
    expect(out.some((d) => d.context?.kind === 'network-require')).toBe(true);
  });

  it('flags new Function()', () => {
    const out = check([
      { id: 'a', type: 'tab', label: 'T' },
      {
        id: 'fn1',
        type: 'function',
        z: 'a',
        x: 0,
        y: 0,
        wires: [[]],
        func: 'const f = new Function("return 1"); return msg;',
      },
    ] as never);
    expect(out.some((d) => d.context?.kind === 'new-function')).toBe(true);
  });

  it('skips if syntax is invalid (function-syntax handles it)', () => {
    const out = check([
      { id: 'a', type: 'tab', label: 'T' },
      {
        id: 'fn1',
        type: 'function',
        z: 'a',
        x: 0,
        y: 0,
        wires: [[]],
        func: 'for(let i = ; i < 10) { setInterval(() => {}, 1); }',
      },
    ] as never);
    expect(out).toEqual([]);
  });
});
