import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/link-resolution.js';

const FIXTURE = path.join(__dirname, '../../../../fixtures/broken/link-resolution.flows.json');

describe('link-resolution', () => {
  it('passes when peers exist and types are valid', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        {
          id: 'lo1',
          type: 'link out',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [],
          mode: 'link',
          links: ['li1'],
        },
        {
          id: 'li1',
          type: 'link in',
          z: 'tab1',
          x: 100,
          y: 0,
          wires: [[]],
          links: ['lo1'],
        },
      ] as never),
    ).toEqual([]);
  });

  it('flags missing peer in fixture', async () => {
    const flows = JSON.parse(await readFile(FIXTURE, 'utf8')) as never;
    const out = check(flows);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.some((d) => d.context?.peerId === 'nonexistent00000')).toBe(true);
  });

  it('flags wrong peer type', () => {
    const out = check([
      { id: 'tab1', type: 'tab', label: 'T' },
      {
        id: 'lo1',
        type: 'link out',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [],
        mode: 'link',
        links: ['debug1'],
      },
      { id: 'debug1', type: 'debug', z: 'tab1', x: 100, y: 0, wires: [] },
    ] as never);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]?.context?.peerType).toBe('debug');
  });

  it('flags link-call with multiple targets', () => {
    const out = check([
      { id: 'tab1', type: 'tab', label: 'T' },
      {
        id: 'lc1',
        type: 'link call',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        links: ['li1', 'li2'],
      },
      { id: 'li1', type: 'link in', z: 'tab1', x: 0, y: 0, wires: [[]], links: ['lc1'] },
      { id: 'li2', type: 'link in', z: 'tab1', x: 0, y: 0, wires: [[]], links: ['lc1'] },
    ] as never);
    expect(out.some((d) => d.message.includes('exactly one'))).toBe(true);
  });

  it('skips static-target checks when linkType is dynamic (Node-RED 3.0+)', () => {
    const out = check([
      { id: 'tab1', type: 'tab', label: 'T' },
      {
        id: 'lo1',
        type: 'link out',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        linkType: 'dynamic',
        links: ['nonexistent-target'], // would fail static check; allowed under dynamic
      },
    ] as never);
    expect(out).toHaveLength(0);
  });

  it('does not enforce link-call exactly-one rule under dynamic linkType', () => {
    const out = check([
      { id: 'tab1', type: 'tab', label: 'T' },
      {
        id: 'lc1',
        type: 'link call',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        linkType: 'dynamic',
        links: [], // empty under dynamic — fine
      },
    ] as never);
    expect(out).toHaveLength(0);
  });

  it('flags duplicate `link in` names (ambiguous under dynamic resolution)', () => {
    const out = check([
      { id: 'tab1', type: 'tab', label: 'T' },
      { id: 'li1', type: 'link in', z: 'tab1', x: 0, y: 0, wires: [[]], name: 'shared' },
      { id: 'li2', type: 'link in', z: 'tab1', x: 0, y: 0, wires: [[]], name: 'shared' },
    ] as never);
    const dupDiags = out.filter((d) => d.message.includes('Duplicate'));
    expect(dupDiags).toHaveLength(2); // one diagnostic per duplicate node
    expect(dupDiags[0]?.context).toMatchObject({ name: 'shared', count: 2 });
  });
});
