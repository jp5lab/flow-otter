import { describe, expect, it } from 'vitest';

import { setWires } from '../../../../../src/toolkit/authoring/operations/set-wires.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

function mkSpec(): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'tab-1',
        label: 'A',
        nodes: [
          { key: 'inj', type: 'inject', label: 'Inj', position: { x: 100, y: 100 } },
          { key: 'fn', type: 'function', label: 'Fn', position: { x: 200, y: 100 } },
          { key: 'd1', type: 'debug', label: 'D1', position: { x: 300, y: 100 } },
          { key: 'd2', type: 'debug', label: 'D2', position: { x: 300, y: 200 } },
          { key: 'd3', type: 'debug', label: 'D3', position: { x: 300, y: 300 } },
        ],
        connections: [
          { fromKey: 'inj', outputPort: 0, toKey: 'fn' },
          { fromKey: 'fn', outputPort: 0, toKey: 'd1' },
          { fromKey: 'fn', outputPort: 0, toKey: 'd2' },
        ],
        groups: [],
        comments: [],
      },
      {
        id: 'tab-2',
        label: 'B',
        nodes: [{ key: 'd-other', type: 'debug', label: 'X', position: { x: 100, y: 100 } }],
        connections: [],
        groups: [],
        comments: [],
      },
    ],
  };
}

describe('setWires', () => {
  it('replaces all wires from (source, port) with new ones', () => {
    const { spec, removed, added } = setWires(mkSpec(), {
      tabId: 'tab-1',
      sourceKey: 'fn',
      outputPort: 0,
      targetKeys: ['d3'],
    });
    expect(removed).toBe(2);
    expect(added).toBe(1);
    const conns = spec.tabs[0]!.connections;
    expect(conns).toEqual([
      { fromKey: 'inj', outputPort: 0, toKey: 'fn' },
      { fromKey: 'fn', outputPort: 0, toKey: 'd3' },
    ]);
  });

  it('clears the port when targetKeys is empty', () => {
    const { spec, removed, added } = setWires(mkSpec(), {
      tabId: 'tab-1',
      sourceKey: 'fn',
      outputPort: 0,
      targetKeys: [],
    });
    expect(removed).toBe(2);
    expect(added).toBe(0);
    const conns = spec.tabs[0]!.connections;
    expect(conns).toEqual([{ fromKey: 'inj', outputPort: 0, toKey: 'fn' }]);
  });

  it('is idempotent', () => {
    const a = setWires(mkSpec(), {
      tabId: 'tab-1',
      sourceKey: 'fn',
      outputPort: 0,
      targetKeys: ['d1', 'd2', 'd3'],
    });
    const b = setWires(a.spec, {
      tabId: 'tab-1',
      sourceKey: 'fn',
      outputPort: 0,
      targetKeys: ['d1', 'd2', 'd3'],
    });
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec));
  });

  it('deduplicates target keys', () => {
    const { spec, added } = setWires(mkSpec(), {
      tabId: 'tab-1',
      sourceKey: 'fn',
      outputPort: 0,
      targetKeys: ['d1', 'd1', 'd2'],
    });
    expect(added).toBe(2);
    const conns = spec.tabs[0]!.connections.filter((c) => c.fromKey === 'fn' && c.outputPort === 0);
    expect(conns.map((c) => c.toKey)).toEqual(['d1', 'd2']);
  });

  it('rejects self-wire', () => {
    expect(() =>
      setWires(mkSpec(), {
        tabId: 'tab-1',
        sourceKey: 'fn',
        outputPort: 0,
        targetKeys: ['fn'],
      }),
    ).toThrow(/to itself/);
  });

  it('rejects cross-tab target (not on same tab)', () => {
    expect(() =>
      setWires(mkSpec(), {
        tabId: 'tab-1',
        sourceKey: 'fn',
        outputPort: 0,
        targetKeys: ['d-other'],
      }),
    ).toThrow(/not found on tab/);
  });

  it('rejects unknown target', () => {
    expect(() =>
      setWires(mkSpec(), {
        tabId: 'tab-1',
        sourceKey: 'fn',
        outputPort: 0,
        targetKeys: ['nope'],
      }),
    ).toThrow(/'nope' not found on tab/);
  });

  it('rejects out-of-range output port', () => {
    expect(() =>
      setWires(mkSpec(), {
        tabId: 'tab-1',
        sourceKey: 'inj',
        outputPort: 5, // inject has 1 output
        targetKeys: ['d1'],
      }),
    ).toThrow(/out of range/);
  });

  it('rejects unknown tab', () => {
    expect(() =>
      setWires(mkSpec(), {
        tabId: 'nope',
        sourceKey: 'fn',
        outputPort: 0,
        targetKeys: ['d1'],
      }),
    ).toThrow(/Tab 'nope' not found/);
  });

  it('rejects unknown source key on tab', () => {
    expect(() =>
      setWires(mkSpec(), {
        tabId: 'tab-1',
        sourceKey: 'no-src',
        outputPort: 0,
        targetKeys: ['d1'],
      }),
    ).toThrow(/'no-src' not found on tab/);
  });

  it('does not touch wires from other source nodes', () => {
    const { spec } = setWires(mkSpec(), {
      tabId: 'tab-1',
      sourceKey: 'fn',
      outputPort: 0,
      targetKeys: ['d3'],
    });
    const injWires = spec.tabs[0]!.connections.filter((c) => c.fromKey === 'inj');
    expect(injWires).toEqual([{ fromKey: 'inj', outputPort: 0, toKey: 'fn' }]);
  });
});
