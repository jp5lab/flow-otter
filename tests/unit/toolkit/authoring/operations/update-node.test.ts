import { describe, expect, it } from 'vitest';

import { updateNode } from '../../../../../src/toolkit/authoring/operations/update-node.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [
        {
          key: 'fn',
          type: 'function',
          label: 'Old',
          position: { x: 100, y: 100 },
          groupKey: 'g1',
          passthrough: { func: 'return msg;', outputs: 1 },
        },
      ],
      connections: [],
      groups: [{ key: 'g1', name: 'G', nodeKeys: ['fn'] }],
      comments: [],
    },
  ],
};

describe('updateNode', () => {
  it('updates only the fields that are present in opts', () => {
    const { spec, updated } = updateNode(baseSpec, 'tab-main', 'fn', { label: 'New' });
    expect(updated).toBe(true);
    const node = spec.tabs[0]!.nodes[0]!;
    expect(node.label).toBe('New');
    expect(node.position).toEqual({ x: 100, y: 100 });
    expect(node.groupKey).toBe('g1');
    expect(node.passthrough).toEqual({ func: 'return msg;', outputs: 1 });
  });

  it('replaces passthrough wholesale (no merge)', () => {
    const { spec } = updateNode(baseSpec, 'tab-main', 'fn', {
      passthrough: { func: 'return null;' },
    });
    expect(spec.tabs[0]!.nodes[0]!.passthrough).toEqual({ func: 'return null;' });
  });

  it('clears groupKey when groupKey is null and leaves it when undefined', () => {
    const cleared = updateNode(baseSpec, 'tab-main', 'fn', { groupKey: null });
    expect(cleared.spec.tabs[0]!.nodes[0]!.groupKey).toBeUndefined();
    const left = updateNode(baseSpec, 'tab-main', 'fn', { label: 'X' });
    expect(left.spec.tabs[0]!.nodes[0]!.groupKey).toBe('g1');
  });

  it('returns updated:false when the node is absent', () => {
    const { spec, updated } = updateNode(baseSpec, 'tab-main', 'missing', { label: 'X' });
    expect(updated).toBe(false);
    expect(spec).toBe(baseSpec);
  });

  it('throws when the tab is missing', () => {
    expect(() => updateNode(baseSpec, 'nope', 'fn', { label: 'X' })).toThrow();
  });

  it('does not mutate the input spec', () => {
    const before = JSON.stringify(baseSpec);
    updateNode(baseSpec, 'tab-main', 'fn', { label: 'New', position: { x: 200, y: 200 } });
    expect(JSON.stringify(baseSpec)).toBe(before);
  });
});
