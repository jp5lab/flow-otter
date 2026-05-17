import { describe, expect, it } from 'vitest';

import { compile } from '../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';

const minimalSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [
        {
          key: 'inj-1',
          type: 'inject',
          label: 'Tick',
          position: { x: 100, y: 100 },
          passthrough: { payload: '', payloadType: 'date', topic: '' },
        },
      ],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

describe('compile', () => {
  it('emits tab + node + correct ordering', () => {
    const { flows } = compile(minimalSpec);
    expect(flows.length).toBe(2);
    expect(flows[0]?.type).toBe('tab');
    expect(flows[1]?.type).toBe('inject');
  });

  it('is idempotent: same spec → byte-identical output', () => {
    const a = compile(minimalSpec);
    const b = compile(minimalSpec);
    expect(JSON.stringify(a.flows)).toBe(JSON.stringify(b.flows));
    expect(a.hash).toBe(b.hash);
  });

  it('preserves IDs from prior when keys match', () => {
    const first = compile(minimalSpec);
    const priorId = first.flows[1]?.id;
    const second = compile(minimalSpec, { prior: first.flows });
    expect(second.flows[1]?.id).toBe(priorId);
  });

  it('emits empty wires array for inject with no connections', () => {
    const { flows } = compile(minimalSpec);
    const node = flows.find((n) => n.type === 'inject') as { wires?: string[][] } | undefined;
    expect(node?.wires).toEqual([[]]);
  });

  it('produces deterministic 16-hex IDs', () => {
    const { flows } = compile(minimalSpec);
    for (const node of flows) {
      expect(node.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('connects two nodes via wires', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [
            { key: 'inj', type: 'inject', position: { x: 100, y: 100 } },
            { key: 'dbg', type: 'debug', position: { x: 300, y: 100 } },
          ],
          connections: [{ fromKey: 'inj', outputPort: 0, toKey: 'dbg' }],
          groups: [],
          comments: [],
        },
      ],
    };
    const { flows } = compile(spec);
    const inj = flows.find((n) => n.type === 'inject') as { wires?: string[][] };
    const dbg = flows.find((n) => n.type === 'debug');
    expect(inj.wires?.[0]).toEqual([dbg?.id]);
  });

  it('sets _authoringKey on every emitted node', () => {
    const { flows } = compile(minimalSpec);
    for (const node of flows) {
      expect((node as Record<string, unknown>)['_authoringKey']).toBeDefined();
    }
  });
});

describe('compile baseline-merge ID preservation', () => {
  it('preserves a node id when the node moves to a different tab', () => {
    const before: AuthoringSpec = {
      tabs: [
        {
          id: 'tabA',
          label: 'Source',
          nodes: [{ key: 'mover', type: 'inject', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
        {
          id: 'tabB',
          label: 'Dest',
          nodes: [],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const beforeRes = compile(before);
    const moverIdBefore = beforeRes.flows.find((n) => n.type === 'inject')?.id;
    expect(moverIdBefore).toBeDefined();

    const after: AuthoringSpec = {
      tabs: [
        {
          id: 'tabA',
          label: 'Source',
          nodes: [],
          connections: [],
          groups: [],
          comments: [],
        },
        {
          id: 'tabB',
          label: 'Dest',
          nodes: [{ key: 'mover', type: 'inject', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const afterRes = compile(after, { prior: beforeRes.flows });
    const moverIdAfter = afterRes.flows.find((n) => n.type === 'inject')?.id;
    expect(moverIdAfter).toBe(moverIdBefore);
  });

  it('does not reuse a group id for a node with the same key (kind partition)', () => {
    const before: AuthoringSpec = {
      tabs: [
        {
          id: 'tabA',
          label: 'A',
          nodes: [],
          connections: [],
          groups: [{ key: 'x', name: 'GroupX', nodeKeys: [] }],
          comments: [],
        },
      ],
    };
    const beforeRes = compile(before);
    const groupId = beforeRes.flows.find((n) => n.type === 'group')?.id;
    expect(groupId).toBeDefined();

    const after: AuthoringSpec = {
      tabs: [
        {
          id: 'tabA',
          label: 'A',
          nodes: [{ key: 'x', type: 'inject', position: { x: 0, y: 0 } }],
          connections: [],
          groups: [{ key: 'x', name: 'GroupX', nodeKeys: [] }],
          comments: [],
        },
      ],
    };
    const afterRes = compile(after, { prior: beforeRes.flows });
    const newNode = afterRes.flows.find((n) => n.type === 'inject');
    expect(newNode?.id).toBeDefined();
    expect(newNode?.id).not.toBe(groupId);
    const groupAfter = afterRes.flows.find((n) => n.type === 'group');
    expect(groupAfter?.id).toBe(groupId);
  });

  it('falls through to a fresh hash when prior is ambiguous (same key on multiple tabs)', () => {
    const before: AuthoringSpec = {
      tabs: [
        {
          id: 'tabA',
          label: 'A',
          nodes: [{ key: 'shared', type: 'inject', position: { x: 0, y: 0 } }],
          connections: [],
          groups: [],
          comments: [],
        },
        {
          id: 'tabB',
          label: 'B',
          nodes: [{ key: 'shared', type: 'debug', position: { x: 0, y: 0 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const beforeRes = compile(before);

    const after: AuthoringSpec = {
      tabs: [
        ...before.tabs,
        {
          id: 'tabC',
          label: 'C',
          nodes: [{ key: 'shared', type: 'function', position: { x: 0, y: 0 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const afterRes = compile(after, { prior: beforeRes.flows });

    const newFnId = afterRes.flows.find((n) => n.type === 'function')?.id;
    const tabCInAfter = afterRes.flows.find(
      (n) => n.type === 'tab' && (n as Record<string, unknown>)['_authoringKey'] === 'tabC',
    );
    expect(newFnId).toBeDefined();
    expect(tabCInAfter).toBeDefined();

    const priorIds = new Set<string>();
    for (const n of beforeRes.flows) priorIds.add(n.id);
    expect(priorIds.has(newFnId!)).toBe(false);
  });

  it('treats delete-then-readd on a different tab as a move (preserves id)', () => {
    const before: AuthoringSpec = {
      tabs: [
        {
          id: 'tabA',
          label: 'A',
          nodes: [{ key: 'k', type: 'inject', position: { x: 0, y: 0 } }],
          connections: [],
          groups: [],
          comments: [],
        },
        {
          id: 'tabB',
          label: 'B',
          nodes: [],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const beforeRes = compile(before);
    const beforeId = beforeRes.flows.find((n) => n.type === 'inject')?.id;

    const after: AuthoringSpec = {
      tabs: [
        {
          id: 'tabA',
          label: 'A',
          nodes: [],
          connections: [],
          groups: [],
          comments: [],
        },
        {
          id: 'tabB',
          label: 'B',
          nodes: [{ key: 'k', type: 'inject', position: { x: 0, y: 0 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const afterRes = compile(after, { prior: beforeRes.flows });
    const afterId = afterRes.flows.find((n) => n.type === 'inject')?.id;
    expect(afterId).toBe(beforeId);
  });

  it('does not generate duplicate ids when two new nodes share a key from prior', () => {
    const before: AuthoringSpec = {
      tabs: [
        {
          id: 'tabA',
          label: 'A',
          nodes: [{ key: 'shared', type: 'inject', position: { x: 0, y: 0 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const beforeRes = compile(before);
    const priorInjectId = beforeRes.flows.find((n) => n.type === 'inject')?.id;

    const after: AuthoringSpec = {
      tabs: [
        {
          id: 'tabA',
          label: 'A',
          nodes: [],
          connections: [],
          groups: [],
          comments: [],
        },
        {
          id: 'tabB',
          label: 'B',
          nodes: [{ key: 'shared', type: 'inject', position: { x: 0, y: 0 } }],
          connections: [],
          groups: [],
          comments: [],
        },
        {
          id: 'tabC',
          label: 'C',
          nodes: [{ key: 'shared', type: 'inject', position: { x: 0, y: 0 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const afterRes = compile(after, { prior: beforeRes.flows });
    const injects = afterRes.flows.filter((n) => n.type === 'inject');
    expect(injects).toHaveLength(2);
    expect(injects[0]!.id).not.toBe(injects[1]!.id);
    const ids = new Set(injects.map((n) => n.id));
    expect(ids.has(priorInjectId!)).toBe(true);
  });

  it('sizes subflow-instance wires from def.passthrough.out length', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [
            {
              key: 'sub-inst',
              type: 'subflow:my-sub',
              label: 'Inst',
              position: { x: 100, y: 100 },
            },
          ],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
      subflowDefs: [
        {
          id: 'my-sub',
          name: 'MySub',
          nodes: [],
          connections: [],
          passthrough: {
            in: [{ x: 0, y: 0, wires: [] }],
            out: [
              { x: 0, y: 0, wires: [] },
              { x: 0, y: 0, wires: [] },
              { x: 0, y: 0, wires: [] },
            ],
          },
        },
      ],
    };
    const { flows } = compile(spec);
    // Instance type is rewritten from authoring-key form (`subflow:my-sub`) to
    // the compiled-id form (`subflow:<noderedId>`) so the subflow-ports
    // validator can resolve the def. Find the instance by the rewritten form.
    const def = flows.find((n) => n.type === 'subflow');
    const inst = flows.find((n) => typeof n.type === 'string' && n.type === `subflow:${def!.id}`);
    expect(inst).toBeDefined();
    const wires = (inst as { wires?: unknown[][] }).wires;
    expect(wires).toBeDefined();
    expect(wires).toHaveLength(3);
    for (const portWires of wires!) expect(portWires).toEqual([]);
  });

  it('rewrites subflow:<authoringKey> → subflow:<noderedId> so the validator can resolve the def', async () => {
    const { runValidators } = await import('../../../../src/toolkit/validate/index.js');
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'sub-inst', type: 'subflow:my-sub', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
      subflowDefs: [
        {
          id: 'my-sub',
          name: 'MySub',
          nodes: [],
          connections: [],
          passthrough: { in: [{ x: 0, y: 0, wires: [] }], out: [{ x: 0, y: 0, wires: [] }] },
        },
      ],
    };
    const { flows } = compile(spec);
    const def = flows.find((n) => n.type === 'subflow');
    const inst = flows.find((n) => typeof n.type === 'string' && n.type.startsWith('subflow:'));
    expect(def?.id).toBeDefined();
    expect((inst as { type: string }).type).toBe(`subflow:${def!.id}`);
    const report = runValidators(flows, { labelCap: 24 });
    const errors = report.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('surfaces compile diagnostics for unresolved wire targets', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'main',
          label: 'Main',
          nodes: [{ key: 'src', type: 'inject', position: { x: 0, y: 0 } }],
          connections: [{ fromKey: 'src', outputPort: 0, toKey: 'does-not-exist' }],
          groups: [],
          comments: [],
        },
      ],
    };
    const result = compile(spec);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.rule).toBe('compile/unresolved-wire-target');
  });

  it('surfaces compile diagnostics for unresolved group refs and members', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'main',
          label: 'Main',
          nodes: [
            { key: 'a', type: 'inject', position: { x: 0, y: 0 }, groupKey: 'no-such-group' },
          ],
          connections: [],
          groups: [
            {
              key: 'g1',
              name: 'G1',
              nodeKeys: ['missing-member'],
              parentKey: 'no-such-parent',
            },
          ],
          comments: [],
        },
      ],
    };
    const result = compile(spec);
    const rules = result.diagnostics.map((d) => d.rule);
    expect(rules).toContain('compile/unresolved-group-ref');
    expect(rules).toContain('compile/unresolved-group-member');
    expect(rules).toContain('compile/unresolved-group-parent');
  });

  it('falls back to single port when subflow def is missing or has no out array', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [
            {
              key: 'sub-inst',
              type: 'subflow:unknown-def',
              label: 'Inst',
              position: { x: 100, y: 100 },
            },
          ],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { flows } = compile(spec);
    const inst = flows.find((n) => typeof n.type === 'string' && n.type.startsWith('subflow:'));
    const wires = (inst as { wires?: unknown[][] }).wires;
    expect(wires).toHaveLength(1);
  });
});
