import { describe, expect, it } from 'vitest';

import type { FlowsJson, FlowsJsonNode } from '../../../../src/shared/flows-json.js';
import { DEFAULT_GROUP_STYLE } from '../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';
import { layoutFlowsJson, layoutTabs } from '../../../../src/toolkit/index.js';

function specWithTabs(): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'tabB',
        label: 'Tab B',
        nodes: [
          { key: 'b1', type: 'inject', position: { x: 0, y: 0 } },
          { key: 'b2', type: 'debug', position: { x: 0, y: 0 } },
        ],
        connections: [{ fromKey: 'b1', outputPort: 0, toKey: 'b2' }],
        groups: [],
        comments: [],
      },
      {
        id: 'tabA',
        label: 'Tab A',
        nodes: [{ key: 'a1', type: 'inject', position: { x: 10, y: 20 } }],
        connections: [],
        groups: [],
        comments: [],
      },
    ],
  };
}

function nodeByKey(spec: AuthoringSpec, tabId: string, key: string) {
  const tab = spec.tabs.find((candidate) => candidate.id === tabId);
  const node = tab?.nodes.find((candidate) => candidate.key === key);
  if (node === undefined) throw new Error(`missing ${tabId}/${key}`);
  return node;
}

function byId(flows: FlowsJson): Map<string, FlowsJsonNode> {
  return new Map(flows.map((node) => [node.id, node]));
}

function stripGeometry(node: FlowsJsonNode): Record<string, unknown> {
  const out = { ...(node as Record<string, unknown>) };
  delete out['x'];
  delete out['y'];
  delete out['w'];
  delete out['h'];
  return out;
}

const REALISH_FLOWS: FlowsJson = [
  { id: 'tabB', type: 'tab', label: 'Main', _authoringKey: 'tabB' },
  { id: 'tabA', type: 'tab', label: 'Sibling', _authoringKey: 'tabA' },
  {
    id: 'start1',
    type: 'inject',
    z: 'tabB',
    x: 800,
    y: 260,
    wires: [['fn1']],
    name: 'Start',
    _authoringKey: 'start',
  },
  {
    id: 'fn1',
    type: 'function',
    z: 'tabB',
    x: 240,
    y: 120,
    wires: [['done1']],
    name: 'Compute',
    func: 'return msg;',
    g: 'group1',
    _authoringKey: 'compute',
  },
  {
    id: 'done1',
    type: 'debug',
    z: 'tabB',
    x: 120,
    y: 380,
    wires: [],
    name: 'Done',
    g: 'group1',
    _authoringKey: 'done',
  },
  {
    id: 'group1',
    type: 'group',
    z: 'tabB',
    x: 80,
    y: 80,
    w: 300,
    h: 360,
    name: 'Processing',
    nodes: ['done1', 'fn1'],
    style: DEFAULT_GROUP_STYLE,
    _authoringKey: 'processing',
  },
  {
    id: 'broker1',
    type: 'mqtt-broker',
    name: 'Local broker',
    broker: 'localhost',
    _authoringKey: 'broker',
  },
  {
    id: 'sibling1',
    type: 'inject',
    z: 'tabA',
    x: 340,
    y: 180,
    wires: [[]],
    name: 'Sibling start',
    _authoringKey: 'sibling',
  },
];

describe('layout toolkit entry points', () => {
  it('layoutTabs lays out scoped tabs through the two-level engine while preserving input tab order', async () => {
    const out = await layoutTabs(specWithTabs(), { tabIds: ['tabB'] });

    expect(out.tabs.map((tab) => tab.id)).toEqual(['tabB', 'tabA']);
    expect(nodeByKey(out, 'tabA', 'a1').position).toEqual({ x: 10, y: 20 });
    expect(nodeByKey(out, 'tabB', 'b1').position).not.toEqual({ x: 0, y: 0 });
    expect(nodeByKey(out, 'tabB', 'b2').position).not.toEqual({ x: 0, y: 0 });
  });

  it('layoutFlowsJson preserves every prior id and wiring while changing only geometry fields', async () => {
    const out = await layoutFlowsJson(REALISH_FLOWS);
    const beforeById = byId(REALISH_FLOWS);
    const afterById = byId(out);

    expect(out.map((node) => node.id)).toEqual(REALISH_FLOWS.map((node) => node.id));
    expect([...afterById.keys()].sort()).toEqual([...beforeById.keys()].sort());
    for (const [id, before] of beforeById) {
      const after = afterById.get(id);
      expect(after).toBeDefined();
      expect(stripGeometry(after!)).toEqual(stripGeometry(before));
      expect((after as { wires?: unknown }).wires).toEqual((before as { wires?: unknown }).wires);
    }
  });

  it('layoutFlowsJson scoped to one tab leaves sibling tab entries byte-identical in place', async () => {
    const out = await layoutFlowsJson(REALISH_FLOWS, { tabIds: ['tabB'] });

    expect(out.map((node) => node.id)).toEqual(REALISH_FLOWS.map((node) => node.id));
    for (const [index, before] of REALISH_FLOWS.entries()) {
      const belongsToSibling = before.id === 'tabA' || (before as { z?: unknown }).z === 'tabA';
      if (belongsToSibling) expect(out[index]).toEqual(before);
    }
  });
});
