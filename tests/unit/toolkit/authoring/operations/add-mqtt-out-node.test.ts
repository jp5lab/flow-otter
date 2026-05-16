import { describe, expect, it } from 'vitest';

import { addMqttOutNode } from '../../../../../src/toolkit/authoring/operations/add-mqtt-out-node.js';
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

describe('addMqttOutNode', () => {
  it('adds exactly one mqtt out node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addMqttOutNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('mqtt out');
  });

  it('throws when tab is not found', () => {
    expect(() => addMqttOutNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'mqtt-out', type: 'mqtt out', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addMqttOutNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('mqtt-out');
    expect(newNodeKey).toBe('mqtt-out-2');
  });
});
