import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/shared/canonical-json.js';
import { compile } from '../../src/toolkit/authoring/compile.js';
import { applyOps, type BatchOp } from '../../src/toolkit/authoring/operations/batch.js';
import type { AuthoringSpec } from '../../src/toolkit/authoring/types.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);

const BASE_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tab1',
      label: 'Main',
      nodes: [
        {
          key: 'source',
          type: 'inject',
          label: 'Source',
          position: { x: 100, y: 100 },
        },
        {
          key: 'worker',
          type: 'function',
          label: 'Worker',
          position: { x: 260, y: 100 },
          passthrough: { func: 'return msg;', outputs: 1 },
        },
        {
          key: 'target',
          type: 'debug',
          label: 'Target',
          position: { x: 420, y: 100 },
        },
        {
          key: 'victim',
          type: 'function',
          label: 'Victim',
          position: { x: 100, y: 220 },
          passthrough: { func: 'return msg;', outputs: 1 },
        },
      ],
      connections: [],
      groups: [],
      comments: [{ key: 'note', text: 'Note', position: { x: 100, y: 40 } }],
      junctions: [],
    },
  ],
};

const BASE_FLOWS = compile(BASE_SPEC).flows;
const VICTIM_ID = BASE_FLOWS.find(
  (n) => (n as Record<string, unknown>)['_authoringKey'] === 'victim',
)!.id;

function foldOneAtATime(ops: readonly BatchOp[]) {
  let spec = BASE_SPEC;
  const tombstones = [];
  const opResults = [];
  for (const [index, op] of ops.entries()) {
    const next = applyOps(spec, BASE_FLOWS, [op]);
    spec = next.spec;
    tombstones.push(...next.idTombstones);
    opResults.push(...next.opResults.map((result) => ({ ...result, index })));
  }
  return { spec, idTombstones: tombstones, opResults };
}

describe('stage_changes batch properties', () => {
  it('folding a batch equals folding the same ops one at a time before compile', () => {
    const moveWorker = fc.record({
      x: fc.integer({ min: 120, max: 700 }),
      y: fc.integer({ min: 80, max: 420 }),
    });
    fc.assert(
      fc.property(moveWorker, moveWorker, (a, b) => {
        const ops: BatchOp[] = [
          { op: 'move_node', tab_id: 'tab1', node_id: 'worker', position: a },
          { op: 'move_node', tab_id: 'tab1', node_id: 'target', position: b },
          { op: 'update_comment', tab_id: 'tab1', comment_key: 'note', text: `n-${a.x}-${b.y}` },
          { op: 'wire_nodes', tab_id: 'tab1', from_key: 'worker', to_key: 'target' },
        ];

        const batch = applyOps(BASE_SPEC, BASE_FLOWS, ops);
        const sequential = foldOneAtATime(ops);

        const batchCompiled = compile(batch.spec, {
          prior: BASE_FLOWS,
          idTombstones: batch.idTombstones,
        });
        const sequentialCompiled = compile(sequential.spec, {
          prior: BASE_FLOWS,
          idTombstones: sequential.idTombstones,
        });

        expect(canonicalJson(batchCompiled.flows)).toBe(canonicalJson(sequentialCompiled.flows));
        expect(batch.opResults).toEqual(sequential.opResults);
      }),
      { numRuns: Math.min(NUM_RUNS, 200) },
    );
  });

  it('remove-then-readd tombstones produce a fresh id and deterministic bytes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('debug', 'function', 'change'),
        fc.integer({ min: 80, max: 500 }),
        fc.integer({ min: 80, max: 500 }),
        (type, x, y) => {
          const passthrough =
            type === 'function'
              ? { func: 'return msg;', outputs: 1 }
              : type === 'change'
                ? { rules: [] }
                : undefined;
          const opts: {
            key: string;
            position: { x: number; y: number };
            passthrough?: Record<string, unknown>;
          } = {
            key: 'victim',
            position: { x, y },
          };
          if (passthrough !== undefined) opts.passthrough = passthrough;
          const ops: BatchOp[] = [
            { op: 'remove_node', tab_id: 'tab1', node_id: 'victim' },
            { op: 'add_node', tab_id: 'tab1', type, opts },
          ];

          const first = applyOps(BASE_SPEC, BASE_FLOWS, ops);
          const compiledFirst = compile(first.spec, {
            prior: BASE_FLOWS,
            idTombstones: first.idTombstones,
          });
          const second = applyOps(BASE_SPEC, BASE_FLOWS, ops);
          const compiledSecond = compile(second.spec, {
            prior: BASE_FLOWS,
            idTombstones: second.idTombstones,
          });

          const replacement = compiledFirst.flows.find(
            (n) => (n as Record<string, unknown>)['_authoringKey'] === 'victim',
          );
          expect(replacement?.id).not.toBe(VICTIM_ID);
          expect(canonicalJson(compiledFirst.flows)).toBe(canonicalJson(compiledSecond.flows));
          expect(compiledFirst.hash).toBe(compiledSecond.hash);
        },
      ),
      { numRuns: Math.min(NUM_RUNS, 200) },
    );
  });
});
