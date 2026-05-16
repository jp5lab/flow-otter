import { describe, expect, it } from 'vitest';

import { wireNodes } from '../../../../../src/toolkit/authoring/operations/wire.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [
        { key: 'a', type: 'inject', position: { x: 100, y: 100 } },
        { key: 'b', type: 'debug', position: { x: 200, y: 100 } },
      ],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

describe('wireNodes', () => {
  it('appends a new connection between two existing nodes', () => {
    const { spec, added } = wireNodes(baseSpec, 'tab-main', 'a', 'b');
    expect(added).toBe(true);
    const conns = spec.tabs[0]!.connections;
    expect(conns.length).toBe(1);
    expect(conns[0]).toEqual({ fromKey: 'a', outputPort: 0, toKey: 'b' });
  });

  it('returns added:false and the same spec when the connection already exists', () => {
    const seeded: AuthoringSpec = {
      tabs: [
        {
          ...baseSpec.tabs[0]!,
          connections: [{ fromKey: 'a', outputPort: 0, toKey: 'b' }],
        },
      ],
    };
    const { spec, added } = wireNodes(seeded, 'tab-main', 'a', 'b');
    expect(added).toBe(false);
    expect(spec).toBe(seeded);
  });

  it('treats different output ports as distinct connections', () => {
    const seeded: AuthoringSpec = {
      tabs: [
        {
          ...baseSpec.tabs[0]!,
          connections: [{ fromKey: 'a', outputPort: 0, toKey: 'b' }],
        },
      ],
    };
    const { spec, added } = wireNodes(seeded, 'tab-main', 'a', 'b', { outputPort: 1 });
    expect(added).toBe(true);
    expect(spec.tabs[0]!.connections.length).toBe(2);
  });

  it('throws when tab, source, or target are missing', () => {
    expect(() => wireNodes(baseSpec, 'missing', 'a', 'b')).toThrow();
    expect(() => wireNodes(baseSpec, 'tab-main', 'nope', 'b')).toThrow();
    expect(() => wireNodes(baseSpec, 'tab-main', 'a', 'nope')).toThrow();
  });

  it('throws on a self-loop', () => {
    expect(() => wireNodes(baseSpec, 'tab-main', 'a', 'a')).toThrow();
  });

  it('does not mutate the input spec', () => {
    const before = JSON.stringify(baseSpec);
    wireNodes(baseSpec, 'tab-main', 'a', 'b');
    expect(JSON.stringify(baseSpec)).toBe(before);
  });
});
