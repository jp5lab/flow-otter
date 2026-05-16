import { describe, expect, it } from 'vitest';

import { addSubflowInstance } from '../../../../../src/toolkit/authoring/operations/add-subflow-instance.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [{ key: 'existing', type: 'function', position: { x: 100, y: 100 } }],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

describe('addSubflowInstance', () => {
  it('adds exactly one subflow instance node with type subflow:<defId>', () => {
    const { spec, newNodeKey } = addSubflowInstance(baseSpec, 'tab-main', 'def-abc');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    const inserted = tab.nodes.find((n) => n.key === newNodeKey);
    expect(inserted?.type).toBe('subflow:def-abc');
    expect(inserted?.label).toBe('Subflow');
    expect(newNodeKey).toBe('subflow-def-abc');
  });

  it('throws when tab is not found', () => {
    expect(() => addSubflowInstance(baseSpec, 'missing', 'def-abc')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [
            { key: 'subflow-def-abc', type: 'subflow:def-abc', position: { x: 100, y: 100 } },
          ],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addSubflowInstance(spec, 'tab-main', 'def-abc');
    expect(newNodeKey).not.toBe('subflow-def-abc');
    expect(newNodeKey).toBe('subflow-def-abc-2');
  });
});
