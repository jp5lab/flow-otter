import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AUTHORING_KEY_FIELD, compile } from '../../src/toolkit/authoring/compile.js';
import type { FlowsJsonNode } from '../../src/shared/flows-json.js';

import { arbitraryCrossTabMove, arbitrarySpecPair } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);

function authoringKey(node: FlowsJsonNode): string | undefined {
  const v = (node as Record<string, unknown>)[AUTHORING_KEY_FIELD];
  return typeof v === 'string' ? v : undefined;
}

function tabIdOf(node: FlowsJsonNode): string {
  if (node.type === 'tab') return node.id;
  return (node as { z?: string }).z ?? '';
}

describe('compile baseline-merge cross-tab move', () => {
  it('preserves the moved node id when a node is moved across tabs', () => {
    fc.assert(
      fc.property(arbitraryCrossTabMove, (move) => {
        const beforeFlows = compile(move.before).flows;
        const afterFlows = compile(move.after, { prior: beforeFlows }).flows;

        const sourceTabBefore = beforeFlows.find(
          (n) => n.type === 'tab' && authoringKey(n) === move.sourceTabKey,
        );
        if (!sourceTabBefore) return;
        const beforeNode = beforeFlows.find(
          (n) =>
            n.type !== 'tab' &&
            authoringKey(n) === move.movedNodeKey &&
            tabIdOf(n) === sourceTabBefore.id,
        );

        const destTabAfter = afterFlows.find(
          (n) => n.type === 'tab' && authoringKey(n) === move.destTabKey,
        );
        if (!destTabAfter) return;
        const afterNode = afterFlows.find(
          (n) =>
            n.type !== 'tab' &&
            authoringKey(n) === move.movedNodeKey &&
            tabIdOf(n) === destTabAfter.id,
        );

        expect(beforeNode?.id).toBeDefined();
        expect(afterNode?.id).toBeDefined();
        expect(afterNode?.id).toBe(beforeNode?.id);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produces no duplicate ids regardless of the change applied', () => {
    fc.assert(
      fc.property(arbitrarySpecPair, ({ before, after }) => {
        const beforeFlows = compile(before).flows;
        const afterFlows = compile(after, { prior: beforeFlows }).flows;
        const seen = new Set<string>();
        for (const n of afterFlows) {
          expect(seen.has(n.id)).toBe(false);
          seen.add(n.id);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
