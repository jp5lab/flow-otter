import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/credential-leak.js';

const FIXTURE = path.join(__dirname, '../../../../fixtures/broken/credential-leak.flows.json');

describe('credential-leak', () => {
  it('passes for benign config', () => {
    expect(
      check([
        { id: 'a', type: 'tab', label: 'T' },
        { id: 'b', type: 'mqtt-broker', name: 'broker', broker: 'localhost' },
      ] as never),
    ).toEqual([]);
  });

  it('flags Bearer JWT in fixture', async () => {
    const flows = JSON.parse(await readFile(FIXTURE, 'utf8')) as never;
    const out = check(flows);
    const errs = out.filter((d) => d.severity === 'error');
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some((d) => d.context?.pattern === 'bearer-jwt')).toBe(true);
  });

  it('flags AKIA AWS access key', () => {
    const out = check([
      { id: 'a', type: 'tab', label: 'T' },
      {
        id: 'b',
        type: 'http request',
        z: 'a',
        x: 0,
        y: 0,
        wires: [[]],
        headers: { 'X-Key': 'AKIAIOSFODNN7EXAMPLE' },
      },
    ] as never);
    expect(out.some((d) => d.context?.pattern === 'aws-access-key')).toBe(true);
  });

  it('does not flag node id even if hex-shaped', () => {
    const out = check([
      { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', type: 'tab', label: 'T' },
    ] as never);
    expect(out).toEqual([]);
  });
});
