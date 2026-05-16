import { describe, expect, it } from 'vitest';

import { addComment } from '../../../../../src/toolkit/authoring/operations/add-comment.js';
import { defaultSpawnPosition } from '../../../../../src/toolkit/authoring/operations/_spawn.js';
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

describe('addComment', () => {
  it('adds exactly one comment with the given text and default spawn position', () => {
    const { spec, newCommentKey } = addComment(baseSpec, 'tab-main', { text: 'Hello' });
    const tab = spec.tabs[0]!;
    expect(tab.comments.length).toBe(1);
    expect(tab.nodes.length).toBe(1);
    const inserted = tab.comments.find((c) => c.key === newCommentKey);
    expect(inserted?.text).toBe('Hello');
    const expected = defaultSpawnPosition(baseSpec.tabs[0]!);
    expect(inserted?.position).toEqual(expected);
    expect(newCommentKey).toBe('comment');
  });

  it('throws when tab is not found', () => {
    expect(() => addComment(baseSpec, 'missing', { text: 'Hello' })).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [],
          connections: [],
          groups: [],
          comments: [{ key: 'comment', text: 'Existing', position: { x: 80, y: 80 } }],
        },
      ],
    };
    const { newCommentKey } = addComment(spec, 'tab-main', { text: 'Another' });
    expect(newCommentKey).not.toBe('comment');
    expect(newCommentKey).toBe('comment-2');
  });

  it('honors an explicit position when provided', () => {
    const { spec, newCommentKey } = addComment(baseSpec, 'tab-main', {
      text: 'Pinned',
      position: { x: 500, y: 600 },
    });
    const inserted = spec.tabs[0]!.comments.find((c) => c.key === newCommentKey);
    expect(inserted?.position).toEqual({ x: 500, y: 600 });
  });
});
