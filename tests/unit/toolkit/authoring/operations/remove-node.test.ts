import { describe, expect, it } from 'vitest';

import { removeNode } from '../../../../../src/toolkit/authoring/operations/remove-node.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [
        { key: 'a', type: 'inject', position: { x: 100, y: 100 } },
        { key: 'b', type: 'debug', position: { x: 200, y: 100 }, groupKey: 'g1' },
        { key: 'c', type: 'function', position: { x: 300, y: 100 } },
      ],
      connections: [
        { fromKey: 'a', outputPort: 0, toKey: 'b' },
        { fromKey: 'b', outputPort: 0, toKey: 'c' },
        { fromKey: 'a', outputPort: 0, toKey: 'c' },
      ],
      groups: [{ key: 'g1', name: 'G1', nodeKeys: ['b', 'c'] }],
      comments: [],
    },
  ],
};

describe('removeNode', () => {
  it('removes the node and every connection referencing it', () => {
    const { spec, removed } = removeNode(baseSpec, 'tab-main', 'b');
    expect(removed).toBe(true);
    const tab = spec.tabs[0]!;
    expect(tab.nodes.map((n) => n.key)).toEqual(['a', 'c']);
    expect(tab.connections).toEqual([{ fromKey: 'a', outputPort: 0, toKey: 'c' }]);
  });

  it('scrubs the removed key from group nodeKeys', () => {
    const { spec } = removeNode(baseSpec, 'tab-main', 'b');
    expect(spec.tabs[0]!.groups[0]!.nodeKeys).toEqual(['c']);
  });

  it('returns removed:false when node is not present', () => {
    const { spec, removed } = removeNode(baseSpec, 'tab-main', 'missing');
    expect(removed).toBe(false);
    expect(spec).toBe(baseSpec);
  });

  it('throws when tab is not found', () => {
    expect(() => removeNode(baseSpec, 'nope', 'a')).toThrow();
  });

  it('does not mutate the input spec', () => {
    const before = JSON.stringify(baseSpec);
    removeNode(baseSpec, 'tab-main', 'b');
    expect(JSON.stringify(baseSpec)).toBe(before);
  });
});
