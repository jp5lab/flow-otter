/**
 * EVAL-6 — pins on the S1 author-loop canary steps file
 * (`scripts/eval/steps/s1-steps.json`), run TWICE by `npm run eval:canary`
 * with the idempotency post-condition (two runs from identically seeded
 * baselines deploy byte-identical flows — EVAL-1's `canonicalFlowsHash`).
 *
 * The file replays the README Tab-1 claim ("full common-author-tools tab")
 * against the committed baseline: every common author node type, inject →
 * function → debug wiring, the set_wires fan-out to mqtt out, the set_links
 * link-call pairing, the 'Idempotent compile' group, and a staging-contract
 * comment — one consented deploy per author op (the HEAD per-op staging
 * cost; WSB-5's batch path is Phase 2). The budget block is the committed
 * number of record: 30 MCP calls / 15 confirmations / 0 failed. Anyone
 * loosening this file loosens the canary gate.
 *
 * The embedded Node-RED ids (set_wires/set_links targets, complete's scope)
 * are the DETERMINISTIC compile-derived ids — recomputed here from the
 * authoring keys via the same generateNodeId the compiler uses, so the
 * steps file can never drift from the id-derivation contract silently
 * (spine: `_authoringKey` ID preservation).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateNodeId } from '../../../../src/shared/ids.js';
import {
  lintSteps,
  normalizeSteps,
  type NormalizedSection,
  type NormalizedStep,
  type NormalizedSteps,
} from '../../../../scripts/eval/driver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEPS_PATH = path.resolve(HERE, '../../../../scripts/eval/steps/s1-steps.json');

/** The committed baseline fixture's tab (tests/fixtures/inject-to-debug.flows.json). */
const TAB_ID = '1111111111111111';
/** The baseline inject node — the README loop's inject; its id doubles as its key. */
const TICK_KEY = '2222222222222222';

/** Compile-derived id for a fresh node key on the baseline tab. */
const derivedId = (key: string): string => generateNodeId(`${TAB_ID}:node:${key}`);

function loadNormalized(): NormalizedSteps {
  return normalizeSteps(JSON.parse(readFileSync(STEPS_PATH, 'utf8')));
}

function section(steps: NormalizedSteps, name: string): NormalizedSection {
  const s = steps.sections.find((x) => x.name === name);
  expect(s, `section '${name}' missing`).toBeDefined();
  return s!;
}

function authorOps(s: NormalizedSection): NormalizedStep[] {
  return s.calls.filter((c) => c.tool !== undefined && c.tool !== 'deploy_staged_change');
}

describe('S1 canary steps file (EVAL-6 — README Tab-1 loop, budget-recorded)', () => {
  it('is structurally valid v2 and passes the anti-gaming lint', () => {
    const steps = loadNormalized();
    expect(steps.version).toBe(2);
    expect(lintSteps(steps)).toEqual([]);
  });

  it('keeps env {} — the canary runner owns the sandboxed environment', () => {
    expect(loadNormalized().env).toEqual({});
  });

  it('is NOT flagged layout_computed — S1 positions are agent-supplied by design at HEAD', () => {
    // The zero-coordinate disqualification rule binds e1-phase2 and S6
    // leg-B specs (AUDIT-RERUN.md), not the README author loop.
    for (const s of loadNormalized().sections) {
      expect(s.layout_computed).toBe(false);
    }
  });

  it('has exactly the author-loop → verify section structure', () => {
    expect(loadNormalized().sections.map((s) => s.name)).toEqual(['author-loop', 'verify']);
  });

  it('author-loop budget is the COMMITTED number of record: 30 calls / 15 confirmations / 0 failed', () => {
    const loop = section(loadNormalized(), 'author-loop');
    expect(loop.budget).toEqual({
      max_mcp_calls: 30,
      max_total_invocations: 30,
      max_deploy_confirmations: 15,
      max_failed: 0,
      max_elicitation_declines: 0,
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 0,
    });
  });

  it('author-loop fits its own budget statically: 15 op+deploy pairs, strictly alternating', () => {
    const loop = section(loadNormalized(), 'author-loop');
    expect(loop.calls).toHaveLength(30);
    loop.calls.forEach((c, i) => {
      if (i % 2 === 0) {
        expect(c.tool, `call ${i} should be an author op`).not.toBe('deploy_staged_change');
        expect(c.expect?.match).toBe('"staged_hash"');
      } else {
        expect(c.tool, `call ${i} should be the paired deploy`).toBe('deploy_staged_change');
        expect(c.elicitation).toBe('accept');
        expect(c.args).toEqual({ staged_hash: '$PREV.staged_hash' });
        expect(c.expect).toEqual({ error: false, match: '"ok": true' });
      }
    });
  });

  it('covers every common author node type the README Tab-1 claim names', () => {
    const loop = section(loadNormalized(), 'author-loop');
    const addedTypes = authorOps(loop)
      .filter((c) => c.tool === 'add_node')
      .map((c) => c.args?.['type']);
    // inject is the baseline fixture's Tick node — the other ten are added.
    expect(addedTypes).toEqual([
      'function',
      'debug',
      'mqtt in',
      'mqtt out',
      'catch',
      'status',
      'complete',
      'link in',
      'link out',
      'link call',
    ]);
  });

  it('exercises the full common-author-tool vocabulary: wire_nodes, set_wires, set_links, add_group, add_comment', () => {
    const loop = section(loadNormalized(), 'author-loop');
    expect(authorOps(loop).map((c) => c.tool)).toEqual([
      ...Array<string>(10).fill('add_node'),
      'wire_nodes',
      'set_wires',
      'set_links',
      'add_group',
      'add_comment',
    ]);
  });

  it('wires inject → function, fans function → [debug, mqtt out] via set_wires (README narrative)', () => {
    const loop = section(loadNormalized(), 'author-loop');
    const wire = loop.calls.find((c) => c.tool === 'wire_nodes')!;
    expect(wire.args).toEqual({ tab_id: TAB_ID, from_key: TICK_KEY, to_key: 's1-function' });
    const fan = loop.calls.find((c) => c.tool === 'set_wires')!;
    expect(fan.args).toEqual({
      tab_id: TAB_ID,
      source_node_id: derivedId('s1-function'),
      target_node_ids: [derivedId('s1-debug'), derivedId('s1-mqtt-out')],
    });
  });

  it('pairs link call → link in via set_links, with the README linkType:"dynamic" prerequisite', () => {
    const loop = section(loadNormalized(), 'author-loop');
    const linkCallAdd = loop.calls.find(
      (c) => c.tool === 'add_node' && c.args?.['type'] === 'link call',
    )!;
    // The README ledger verbatim: "link call rejected links: [] until
    // linkType: 'dynamic' was set" — the canary pins that knowledge.
    expect((linkCallAdd.args?.['opts'] as { passthrough?: unknown }).passthrough).toEqual({
      linkType: 'dynamic',
    });
    const links = loop.calls.find((c) => c.tool === 'set_links')!;
    expect(links.args).toEqual({
      source_node_id: derivedId('s1-link-call'),
      target_node_ids: [derivedId('s1-link-in')],
    });
  });

  it("complete's scope points at the function node by its compile-derived id (README ledger)", () => {
    const loop = section(loadNormalized(), 'author-loop');
    const complete = loop.calls.find(
      (c) => c.tool === 'add_node' && c.args?.['type'] === 'complete',
    )!;
    expect((complete.args?.['opts'] as { passthrough?: unknown }).passthrough).toEqual({
      scope: [derivedId('s1-function')],
    });
  });

  it("groups the canonical author loop as 'Idempotent compile' and drops the staging-contract comment", () => {
    const loop = section(loadNormalized(), 'author-loop');
    const group = loop.calls.find((c) => c.tool === 'add_group')!;
    expect(group.args?.['name']).toBe('Idempotent compile');
    expect(group.args?.['node_keys']).toEqual(['s1-function', 's1-debug']);
    const comment = loop.calls.find((c) => c.tool === 'add_comment')!;
    expect(comment.args?.['text']).toContain('Staging contract');
  });

  it('every author call targets the committed baseline tab; no force/oob anywhere', () => {
    const steps = loadNormalized();
    for (const s of steps.sections) {
      for (const c of s.calls) {
        if (c.args?.['tab_id'] !== undefined) expect(c.args['tab_id']).toBe(TAB_ID);
        expect(c.args?.['force']).toBeUndefined();
        expect(c.args?.['force_takeover']).toBeUndefined();
        expect(c.mutates).not.toBe(true);
      }
    }
  });

  it('verify section: validate_flow must come back clean (README claim: validates clean)', () => {
    const verify = section(loadNormalized(), 'verify');
    expect(verify.budget).toEqual({
      max_mcp_calls: 1,
      max_failed: 0,
      max_deploy_confirmations: 0,
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 0,
    });
    expect(verify.calls).toHaveLength(1);
    expect(verify.calls[0]!.tool).toBe('validate_flow');
    expect(verify.calls[0]!.expect).toEqual({ error: false, match: '"has_errors": false' });
  });
});
