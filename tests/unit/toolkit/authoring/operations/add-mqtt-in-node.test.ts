import { describe, expect, it } from 'vitest';

import { addMqttInNode } from '../../../../../src/toolkit/authoring/operations/add-mqtt-in-node.js';
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

describe('addMqttInNode', () => {
  it('adds exactly one mqtt in node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addMqttInNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('mqtt in');
  });

  it('throws when tab is not found', () => {
    expect(() => addMqttInNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'mqtt-in', type: 'mqtt in', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addMqttInNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('mqtt-in');
    expect(newNodeKey).toBe('mqtt-in-2');
  });
});
