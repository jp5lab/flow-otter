import { describe, expect, it } from 'vitest';

import { removeComment } from '../../../../../src/toolkit/authoring/operations/remove-comment.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [],
      connections: [],
      groups: [{ key: 'g1', name: 'Group', nodeKeys: ['note'] }],
      comments: [
        { key: 'note', text: 'operator note', position: { x: 100, y: 100 }, groupKey: 'g1' },
      ],
    },
  ],
};

describe('removeComment', () => {
  it('removes the comment and scrubs group membership', () => {
    const { spec, removed } = removeComment(baseSpec, 'tab-main', 'note');
    expect(removed).toBe(true);
    expect(spec.tabs[0]!.comments).toEqual([]);
    expect(spec.tabs[0]!.groups[0]!.nodeKeys).toEqual([]);
  });

  it('throws when tab or comment is not found', () => {
    expect(() => removeComment(baseSpec, 'missing', 'note')).toThrow();
    expect(() => removeComment(baseSpec, 'tab-main', 'missing')).toThrow();
  });
});
