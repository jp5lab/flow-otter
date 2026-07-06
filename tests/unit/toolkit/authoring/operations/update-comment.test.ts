import { describe, expect, it } from 'vitest';

import { updateComment } from '../../../../../src/toolkit/authoring/operations/update-comment.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [],
      connections: [],
      groups: [
        { key: 'old', name: 'Old', nodeKeys: ['note'] },
        { key: 'new', name: 'New', nodeKeys: [] },
      ],
      comments: [
        {
          key: 'note',
          text: 'Old note',
          position: { x: 100, y: 100 },
          size: { w: 160, h: 40 },
          info: 'old body',
          groupKey: 'old',
        },
      ],
    },
  ],
};

describe('updateComment', () => {
  it('updates comment fields and moves group membership', () => {
    const { spec, updated } = updateComment(baseSpec, 'tab-main', 'note', {
      text: 'New note',
      position: { x: 240, y: 180 },
      size: { w: 220, h: 60 },
      info: 'new body',
      groupKey: 'new',
    });

    expect(updated).toBe(true);
    const tab = spec.tabs[0]!;
    expect(tab.comments[0]).toMatchObject({
      key: 'note',
      text: 'New note',
      position: { x: 240, y: 180 },
      size: { w: 220, h: 60 },
      info: 'new body',
      groupKey: 'new',
    });
    expect(tab.groups.find((g) => g.key === 'old')?.nodeKeys).toEqual([]);
    expect(tab.groups.find((g) => g.key === 'new')?.nodeKeys).toEqual(['note']);
  });

  it('clears optional fields with null', () => {
    const { spec } = updateComment(baseSpec, 'tab-main', 'note', {
      size: null,
      info: null,
      groupKey: null,
    });

    const tab = spec.tabs[0]!;
    expect(tab.comments[0]!.size).toBeUndefined();
    expect(tab.comments[0]!.info).toBeUndefined();
    expect(tab.comments[0]!.groupKey).toBeUndefined();
    expect(tab.groups.find((g) => g.key === 'old')?.nodeKeys).toEqual([]);
  });

  it('throws when tab or comment is not found', () => {
    expect(() => updateComment(baseSpec, 'missing', 'note', { text: 'X' })).toThrow();
    expect(() => updateComment(baseSpec, 'tab-main', 'missing', { text: 'X' })).toThrow();
  });

  it('does not mutate the input spec', () => {
    const before = JSON.stringify(baseSpec);
    updateComment(baseSpec, 'tab-main', 'note', { text: 'New note' });
    expect(JSON.stringify(baseSpec)).toBe(before);
  });
});
