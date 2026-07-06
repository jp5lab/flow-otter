import { describe, expect, it } from 'vitest';

import { createSubflowDefinition } from '../../../../../src/toolkit/authoring/operations/create-subflow-definition.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

describe('createSubflowDefinition', () => {
  it('appends a new subflow definition with default id and empty nodes/connections', () => {
    const { spec, newDefId } = createSubflowDefinition(baseSpec, { name: 'My Subflow' });
    expect(newDefId).toBe('subflow-def');
    const defs = spec.subflowDefs!;
    expect(defs.length).toBe(1);
    expect(defs[0]!.name).toBe('My Subflow');
    expect(defs[0]!.nodes).toEqual([]);
    expect(defs[0]!.connections).toEqual([]);
  });

  it('uses a custom id and propagates nodes/connections/passthrough', () => {
    const { spec, newDefId } = createSubflowDefinition(baseSpec, {
      id: 'def-x',
      name: 'X',
      nodes: [{ key: 'in', type: 'subflow:in', position: { x: 0, y: 0 } }],
      connections: [{ fromKey: 'in', outputPort: 0, toKey: 'out' }],
      env: [
        { name: 'BROKER', type: 'conf-type', value: 'mqtt-broker' },
        { name: 'TOPIC', type: 'str', value: 'sensors/temperature' },
      ],
      passthrough: { category: 'common' },
    });
    expect(newDefId).toBe('def-x');
    const def = spec.subflowDefs![0]!;
    expect(def.nodes.length).toBe(1);
    expect(def.connections.length).toBe(1);
    expect(def.env).toEqual([
      { name: 'BROKER', type: 'conf-type', value: 'mqtt-broker' },
      { name: 'TOPIC', type: 'str', value: 'sensors/temperature' },
    ]);
    expect(def.passthrough).toEqual({ category: 'common' });
  });

  it('uses a unique id suffix when default id collides', () => {
    const seeded: AuthoringSpec = {
      ...baseSpec,
      subflowDefs: [{ id: 'subflow-def', name: 'Existing', nodes: [], connections: [] }],
    };
    const { newDefId } = createSubflowDefinition(seeded, { name: 'Another' });
    expect(newDefId).toBe('subflow-def-2');
  });

  it('throws when the name is empty', () => {
    expect(() => createSubflowDefinition(baseSpec, { name: '' })).toThrow();
  });

  it('does not mutate the input spec', () => {
    const before = JSON.stringify(baseSpec);
    createSubflowDefinition(baseSpec, { name: 'Whatever' });
    expect(JSON.stringify(baseSpec)).toBe(before);
  });
});
