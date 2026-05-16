import { describe, expect, it } from 'vitest';

import { setLinks } from '../../../../../src/toolkit/authoring/operations/set-links.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

function mkSpec(): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'tab-1',
        label: 'A',
        nodes: [
          {
            key: 'lout-a',
            type: 'link out',
            label: 'Out A',
            position: { x: 100, y: 100 },
          },
          {
            key: 'lcall-a',
            type: 'link call',
            label: 'Call A',
            position: { x: 200, y: 100 },
          },
        ],
        connections: [],
        groups: [],
        comments: [],
      },
      {
        id: 'tab-2',
        label: 'B',
        nodes: [
          {
            key: 'lin-b1',
            type: 'link in',
            label: 'In B1',
            position: { x: 100, y: 100 },
          },
          {
            key: 'lin-b2',
            type: 'link in',
            label: 'In B2',
            position: { x: 200, y: 100 },
          },
          {
            key: 'inject-x',
            type: 'inject',
            label: 'Inj',
            position: { x: 300, y: 100 },
          },
        ],
        connections: [],
        groups: [],
        comments: [],
      },
    ],
  };
}

function mkFlows() {
  return [
    { id: 'tab-1', type: 'tab', label: 'A', disabled: false, info: '' },
    { id: 'tab-2', type: 'tab', label: 'B', disabled: false, info: '' },
    {
      id: 'id-lout-a',
      type: 'link out',
      z: 'tab-1',
      x: 100,
      y: 100,
      wires: [],
      name: 'Out A',
      _authoringKey: 'lout-a',
    },
    {
      id: 'id-lcall-a',
      type: 'link call',
      z: 'tab-1',
      x: 200,
      y: 100,
      wires: [[]],
      name: 'Call A',
      _authoringKey: 'lcall-a',
    },
    {
      id: 'id-lin-b1',
      type: 'link in',
      z: 'tab-2',
      x: 100,
      y: 100,
      wires: [[]],
      name: 'In B1',
      _authoringKey: 'lin-b1',
    },
    {
      id: 'id-lin-b2',
      type: 'link in',
      z: 'tab-2',
      x: 200,
      y: 100,
      wires: [[]],
      name: 'In B2',
      _authoringKey: 'lin-b2',
    },
    {
      id: 'id-inject-x',
      type: 'inject',
      z: 'tab-2',
      x: 300,
      y: 100,
      wires: [[]],
      name: 'Inj',
      _authoringKey: 'inject-x',
    },
  ];
}

describe('setLinks', () => {
  it('pairs link out → single link in (cross-tab)', () => {
    const { spec, paired } = setLinks(mkSpec(), {
      sourceKey: 'lout-a',
      targetKeys: ['lin-b1'],
      priorFlows: mkFlows(),
    });
    expect(paired).toBe(1);
    const out = spec.tabs[0]!.nodes[0]!;
    expect(out.passthrough?.['links']).toEqual(['id-lin-b1']);
  });

  it('pairs link out → multiple link in', () => {
    const { spec, paired } = setLinks(mkSpec(), {
      sourceKey: 'lout-a',
      targetKeys: ['lin-b1', 'lin-b2'],
      priorFlows: mkFlows(),
    });
    expect(paired).toBe(2);
    const out = spec.tabs[0]!.nodes[0]!;
    expect(out.passthrough?.['links']).toEqual(['id-lin-b1', 'id-lin-b2']);
  });

  it('pairs link call → link in', () => {
    const { spec, paired } = setLinks(mkSpec(), {
      sourceKey: 'lcall-a',
      targetKeys: ['lin-b1'],
      priorFlows: mkFlows(),
    });
    expect(paired).toBe(1);
    const call = spec.tabs[0]!.nodes[1]!;
    expect(call.passthrough?.['links']).toEqual(['id-lin-b1']);
  });

  it('clears links when target list is empty', () => {
    const initial = setLinks(mkSpec(), {
      sourceKey: 'lout-a',
      targetKeys: ['lin-b1', 'lin-b2'],
      priorFlows: mkFlows(),
    });
    const cleared = setLinks(initial.spec, {
      sourceKey: 'lout-a',
      targetKeys: [],
      priorFlows: mkFlows(),
    });
    expect(cleared.paired).toBe(0);
    const out = cleared.spec.tabs[0]!.nodes[0]!;
    expect(out.passthrough?.['links']).toEqual([]);
  });

  it('is idempotent — same input produces equal spec', () => {
    const a = setLinks(mkSpec(), {
      sourceKey: 'lout-a',
      targetKeys: ['lin-b1'],
      priorFlows: mkFlows(),
    });
    const b = setLinks(a.spec, {
      sourceKey: 'lout-a',
      targetKeys: ['lin-b1'],
      priorFlows: mkFlows(),
    });
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec));
  });

  it('rejects when source is not a link out / link call', () => {
    expect(() =>
      setLinks(mkSpec(), {
        sourceKey: 'inject-x',
        targetKeys: ['lin-b1'],
        priorFlows: mkFlows(),
      }),
    ).toThrow(/expected 'link out' or 'link call'/);
  });

  it('rejects when target is not a link in', () => {
    expect(() =>
      setLinks(mkSpec(), {
        sourceKey: 'lout-a',
        targetKeys: ['inject-x'],
        priorFlows: mkFlows(),
      }),
    ).toThrow(/expected 'link in'/);
  });

  it('rejects unknown source key', () => {
    expect(() =>
      setLinks(mkSpec(), {
        sourceKey: 'nope',
        targetKeys: ['lin-b1'],
        priorFlows: mkFlows(),
      }),
    ).toThrow(/Source node 'nope' not found/);
  });

  it('rejects unknown target key', () => {
    expect(() =>
      setLinks(mkSpec(), {
        sourceKey: 'lout-a',
        targetKeys: ['nope'],
        priorFlows: mkFlows(),
      }),
    ).toThrow(/Target node 'nope' not found/);
  });

  it('rejects target that has no Node-RED id in prior flows (not deployed yet)', () => {
    // Spec has a target but prior flows do not (e.g. it's brand-new and not
    // yet compiled+deployed). Pairing is impossible until both are committed.
    const spec = mkSpec();
    const undeployedSpec: AuthoringSpec = {
      ...spec,
      tabs: spec.tabs.map((t, i) =>
        i === 1
          ? {
              ...t,
              nodes: [
                ...t.nodes,
                {
                  key: 'lin-new',
                  type: 'link in',
                  label: 'New',
                  position: { x: 400, y: 100 },
                },
              ],
            }
          : t,
      ),
    };
    expect(() =>
      setLinks(undeployedSpec, {
        sourceKey: 'lout-a',
        targetKeys: ['lin-new'],
        priorFlows: mkFlows(),
      }),
    ).toThrow(/no Node-RED id yet/);
  });
});
