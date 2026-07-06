import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../../../../src/shared/canonical-json.js';
import { addNode } from '../../../../../src/toolkit/authoring/operations/add-node.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [{ key: 'src', type: 'inject', position: { x: 100, y: 80 } }],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

describe('addNode placement', () => {
  it('uses the left-margin new-row fallback when no source or explicit position is supplied', () => {
    const { spec, newNodeKey } = addNode(baseSpec, 'tab-main', 'switch', {
      key: 'route',
      label: 'Route',
      passthrough: { rules: [{ t: 'eq', v: '1', vt: 'num' }] },
    });

    expect(spec.tabs[0]!.nodes.find((n) => n.key === newNodeKey)?.position).toEqual({
      x: 120,
      y: 180,
    });
  });

  it('keeps explicit-position additions byte-identical to a manually authored spec', () => {
    const actual = addNode(baseSpec, 'tab-main', 'function', {
      key: 'worker',
      label: 'Worker',
      position: { x: 333, y: 107 },
      sourceNodeKey: 'src',
    }).spec;
    const expected: AuthoringSpec = {
      tabs: [
        {
          ...baseSpec.tabs[0]!,
          nodes: [
            baseSpec.tabs[0]!.nodes[0]!,
            {
              key: 'worker',
              type: 'function',
              label: 'Worker',
              position: { x: 340, y: 100 },
            },
          ],
          connections: [{ fromKey: 'src', outputPort: 0, toKey: 'worker' }],
        },
      ],
    };

    expect(canonicalJson(compile(actual, { idStrategy: 'fixed' }).flows)).toBe(
      canonicalJson(compile(expected, { idStrategy: 'fixed' }).flows),
    );
  });

  it('propagates node info into the added NodeSpec', () => {
    const { spec, newNodeKey } = addNode(baseSpec, 'tab-main', 'function', {
      key: 'worker',
      label: 'Worker',
      info: 'Documents the worker stage.',
      position: { x: 320, y: 100 },
    });
    const node = spec.tabs[0]!.nodes.find((n) => n.key === newNodeKey) as
      | { readonly info?: string }
      | undefined;
    expect(node?.info).toBe('Documents the worker stage.');
  });
});
