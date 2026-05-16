import { describe, expect, it } from 'vitest';

import { diffFlows, summarizeDiff } from '../../../../src/toolkit/diff/semantic.js';

const tab = { id: 'tab1', type: 'tab', label: 'Tab' } as const;

describe('diffFlows', () => {
  it('detects an added node', () => {
    const prior = [tab, { id: 'a', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [] }];
    const next = [
      tab,
      { id: 'a', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [] },
      { id: 'b', type: 'debug', z: 'tab1', x: 100, y: 0, wires: [] },
    ];
    const diff = diffFlows(prior, next);
    expect(diff.added.nodes).toHaveLength(1);
    expect(diff.added.nodes[0]?.id).toBe('b');
    expect(diff.removed.nodes).toHaveLength(0);
  });

  it('detects an added wire', () => {
    const prior = [
      tab,
      { id: 'a', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [[]] },
      { id: 'b', type: 'debug', z: 'tab1', x: 100, y: 0, wires: [] },
    ];
    const next = [
      tab,
      { id: 'a', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [['b']] },
      { id: 'b', type: 'debug', z: 'tab1', x: 100, y: 0, wires: [] },
    ];
    const diff = diffFlows(prior, next);
    expect(diff.added.wires).toHaveLength(1);
    expect(diff.added.wires[0]).toEqual({ fromId: 'a', outputPort: 0, toId: 'b' });
  });

  it('detects modified field', () => {
    const prior = [tab, { id: 'a', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [] }];
    const next = [tab, { id: 'a', type: 'inject', z: 'tab1', x: 200, y: 0, wires: [] }];
    const diff = diffFlows(prior, next);
    expect(diff.modified.nodes).toHaveLength(1);
    expect(diff.modified.nodes[0]?.fields).toContain('x');
  });

  it('summary counts match the diff arrays', () => {
    const prior = [tab];
    const next = [tab, { id: 'b', type: 'debug', z: 'tab1', x: 0, y: 0, wires: [] }];
    const diff = diffFlows(prior, next);
    expect(summarizeDiff(diff).nodes_added).toBe(1);
  });

  it('empty diff for identical inputs', () => {
    const flows = [tab, { id: 'a', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [] }];
    const diff = diffFlows(flows, flows);
    expect(diff.added.nodes).toHaveLength(0);
    expect(diff.removed.nodes).toHaveLength(0);
    expect(diff.modified.nodes).toHaveLength(0);
  });
});
