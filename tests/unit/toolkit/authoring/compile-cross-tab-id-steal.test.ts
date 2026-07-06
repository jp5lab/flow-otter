import { describe, expect, it } from 'vitest';

import type { FlowsJson, FlowsJsonNode } from '../../../../src/shared/flows-json.js';
import { generateNodeId } from '../../../../src/shared/ids.js';
import { AUTHORING_KEY_FIELD, compile } from '../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';

function authoringKey(node: FlowsJsonNode): string | undefined {
  const key = (node as Record<string, unknown>)[AUTHORING_KEY_FIELD];
  return typeof key === 'string' ? key : undefined;
}

function tabId(flows: FlowsJson, key: string): string {
  const tab = flows.find((n) => n.type === 'tab' && authoringKey(n) === key);
  expect(tab).toBeDefined();
  return tab!.id;
}

function canvasNode(
  flows: FlowsJson,
  type: 'group' | 'comment',
  tabKey: string,
  key: string,
): FlowsJsonNode {
  const z = tabId(flows, tabKey);
  const node = flows.find(
    (n) => n.type === type && (n as { z?: string }).z === z && authoringKey(n) === key,
  );
  expect(node).toBeDefined();
  return node!;
}

function expectUniqueIds(flows: FlowsJson): void {
  const ids = flows.map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
}

const ownerGroupSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-a',
      label: 'Owner',
      nodes: [],
      connections: [],
      groups: [{ key: 'shared', name: 'Owner group', nodeKeys: [] }],
      comments: [],
    },
  ],
};

function groupAfterSpec(
  tabs: readonly ['new', 'owner'] | readonly ['owner', 'new'],
): AuthoringSpec {
  const owner = ownerGroupSpec.tabs[0]!;
  const newer = {
    id: 'tab-b',
    label: 'New',
    nodes: [],
    connections: [],
    groups: [{ key: 'shared', name: 'New group', nodeKeys: [] }],
    comments: [],
  };
  return {
    tabs: tabs.map((tab) => (tab === 'owner' ? owner : newer)),
  };
}

const ownerCommentSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-a',
      label: 'Owner',
      nodes: [],
      connections: [],
      groups: [],
      comments: [{ key: 'shared', text: 'Owner comment', position: { x: 100, y: 100 } }],
    },
  ],
};

function commentAfterSpec(
  tabs: readonly ['new', 'owner'] | readonly ['owner', 'new'],
): AuthoringSpec {
  const owner = ownerCommentSpec.tabs[0]!;
  const newer = {
    id: 'tab-b',
    label: 'New',
    nodes: [],
    connections: [],
    groups: [],
    comments: [{ key: 'shared', text: 'New comment', position: { x: 200, y: 100 } }],
  };
  return {
    tabs: tabs.map((tab) => (tab === 'owner' ? owner : newer)),
  };
}

describe('compile cross-tab exact ID ownership', () => {
  it('does not let a new same-key group on an earlier tab steal the owner id', () => {
    const before = compile(ownerGroupSpec);
    const ownerBefore = canvasNode(before.flows, 'group', 'tab-a', 'shared');

    const after = compile(groupAfterSpec(['new', 'owner']), { prior: before.flows });
    const ownerAfter = canvasNode(after.flows, 'group', 'tab-a', 'shared');
    const newGroup = canvasNode(after.flows, 'group', 'tab-b', 'shared');

    expectUniqueIds(after.flows);
    expect(ownerAfter.id).toBe(ownerBefore.id);
    expect(newGroup.id).not.toBe(ownerBefore.id);
  });

  it('does not let a new same-key comment on an earlier tab steal the owner id', () => {
    const before = compile(ownerCommentSpec);
    const ownerBefore = canvasNode(before.flows, 'comment', 'tab-a', 'shared');

    const after = compile(commentAfterSpec(['new', 'owner']), { prior: before.flows });
    const ownerAfter = canvasNode(after.flows, 'comment', 'tab-a', 'shared');
    const newComment = canvasNode(after.flows, 'comment', 'tab-b', 'shared');

    expectUniqueIds(after.flows);
    expect(ownerAfter.id).toBe(ownerBefore.id);
    expect(newComment.id).not.toBe(ownerBefore.id);
  });

  it('resolves duplicate group keys independent of tab declaration order', () => {
    const before = compile(ownerGroupSpec);
    const ownerBefore = canvasNode(before.flows, 'group', 'tab-a', 'shared');

    const newFirst = compile(groupAfterSpec(['new', 'owner']), { prior: before.flows });
    const ownerFirst = compile(groupAfterSpec(['owner', 'new']), { prior: before.flows });

    expectUniqueIds(newFirst.flows);
    expectUniqueIds(ownerFirst.flows);
    expect(canvasNode(newFirst.flows, 'group', 'tab-a', 'shared').id).toBe(ownerBefore.id);
    expect(canvasNode(ownerFirst.flows, 'group', 'tab-a', 'shared').id).toBe(ownerBefore.id);
    expect(canvasNode(newFirst.flows, 'group', 'tab-b', 'shared').id).toBe(
      canvasNode(ownerFirst.flows, 'group', 'tab-b', 'shared').id,
    );
  });

  it('salts fresh ids instead of reusing deleted prior ids', () => {
    const seed = 'tab1:group:fresh';
    const deletedPriorId = generateNodeId(seed);
    const prior: FlowsJson = [
      { id: 'tab1', type: 'tab', label: 'Main', [AUTHORING_KEY_FIELD]: 'tab1' },
      {
        id: deletedPriorId,
        type: 'group',
        z: 'tab1',
        name: 'Deleted',
        nodes: [],
        [AUTHORING_KEY_FIELD]: 'deleted',
      },
    ];
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab1',
          label: 'Main',
          nodes: [],
          connections: [],
          groups: [{ key: 'fresh', name: 'Fresh', nodeKeys: [] }],
          comments: [],
        },
      ],
    };

    const after = compile(spec, { prior });
    const group = canvasNode(after.flows, 'group', 'tab1', 'fresh');

    expectUniqueIds(after.flows);
    expect(group.id).not.toBe(deletedPriorId);
    expect(group.id).toBe(generateNodeId(`${seed}~1`));
  });
});
