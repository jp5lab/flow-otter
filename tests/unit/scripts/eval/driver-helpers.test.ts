/**
 * EVAL-1 — pure-helper pins for the promoted eval driver:
 * steps-file schema v2 normalization, the anti-gaming position-field lint
 * ([Amended: gates blocker]), the $PREV-poisoning hard error (the audit's
 * 79-call-cascade class), and FLOW_OTTER_CMD parsing.
 */
import { describe, expect, it } from 'vitest';

import {
  createPrevTracker,
  findPositionFields,
  lintSteps,
  normalizeSteps,
  parseFlowOtterCmd,
  PrevPoisonedError,
  StepsFileError,
} from '../../../../scripts/eval/driver.mjs';

describe('normalizeSteps — schema v2', () => {
  it('wraps a v1 flat file into a single unbudgeted section named main', () => {
    const norm = normalizeSteps({ env: { A: 'b' }, calls: [{ tool: 'list_flows' }] });
    expect(norm.version).toBe(2);
    expect(norm.sections).toHaveLength(1);
    expect(norm.sections[0]).toMatchObject({
      name: 'main',
      budget: null,
      layout_computed: false,
    });
    expect(norm.sections[0]!.calls).toEqual([{ tool: 'list_flows' }]);
  });

  it('accepts a v2 file with sections, budgets, layout_computed, expect, mutates, elicitation', () => {
    const norm = normalizeSteps({
      version: 2,
      sections: [
        {
          name: 'setup',
          calls: [{ tool: 'get_flows_summary', expect: { error: false } }],
        },
        {
          name: 'loop',
          budget: { max_total_invocations: 6, max_failed: 0 },
          layout_computed: true,
          calls: [
            { tool: 'deploy_staged_change', args: { staged_hash: 'x' }, elicitation: 'accept' },
            { exec: 'echo hi', mutates: true, expect: { match: 'hi' } },
            { sleep: 10 },
          ],
        },
      ],
    });
    expect(norm.sections.map((s) => s.name)).toEqual(['setup', 'loop']);
    expect(norm.sections[1]!.budget).toEqual({ max_total_invocations: 6, max_failed: 0 });
    expect(norm.sections[1]!.layout_computed).toBe(true);
  });

  it('rejects version 2 with top-level calls and version 1 with sections', () => {
    expect(() => normalizeSteps({ version: 2, calls: [] })).toThrow(StepsFileError);
    expect(() => normalizeSteps({ version: 1, sections: [] })).toThrow(StepsFileError);
  });

  it('rejects unknown top-level keys, unknown section keys, and unknown step keys', () => {
    expect(() => normalizeSteps({ section: [] })).toThrow(/unknown key 'section'/);
    expect(() =>
      normalizeSteps({ version: 2, sections: [{ name: 'a', budgets: {}, calls: [] }] }),
    ).toThrow(/unknown key 'budgets'/);
    expect(() =>
      normalizeSteps({
        version: 2,
        sections: [{ name: 'a', calls: [{ tool: 't', mutates: true }] }],
      }),
    ).toThrow(/unknown key 'mutates'/);
  });

  it('rejects unknown budget keys at parse time (typo-proof gates)', () => {
    expect(() =>
      normalizeSteps({
        version: 2,
        sections: [{ name: 'a', budget: { max_calls: 3 }, calls: [] }],
      }),
    ).toThrow(/unknown budget key 'max_calls'/);
  });

  it('rejects steps that are not exactly one of tool|exec|sleep', () => {
    expect(() => normalizeSteps({ version: 2, sections: [{ name: 'a', calls: [{}] }] })).toThrow(
      /exactly one of 'tool' \| 'exec' \| 'sleep'/,
    );
    expect(() =>
      normalizeSteps({
        version: 2,
        sections: [{ name: 'a', calls: [{ tool: 't', exec: 'e' }] }],
      }),
    ).toThrow(/exactly one of/);
  });

  it('rejects bad elicitation values, bad expect shapes, and invalid expect regexes', () => {
    expect(() =>
      normalizeSteps({
        version: 2,
        sections: [{ name: 'a', calls: [{ tool: 't', elicitation: 'maybe' }] }],
      }),
    ).toThrow(/'elicitation' must be 'accept' or 'decline'/);
    expect(() =>
      normalizeSteps({
        version: 2,
        sections: [{ name: 'a', calls: [{ exec: 'e', expect: { error: true } }] }],
      }),
    ).toThrow(/'error' is only valid on tool steps/);
    expect(() =>
      normalizeSteps({
        version: 2,
        sections: [{ name: 'a', calls: [{ tool: 't', expect: { match: '[' } }] }],
      }),
    ).toThrow(/not a valid regex/);
  });

  it('rejects duplicate section names', () => {
    expect(() =>
      normalizeSteps({
        version: 2,
        sections: [
          { name: 'a', calls: [] },
          { name: 'a', calls: [] },
        ],
      }),
    ).toThrow(/duplicate section name 'a'/);
  });
});

describe('findPositionFields / lintSteps — anti-gaming position lint', () => {
  it('finds position keys and numeric x/y at any depth, with paths', () => {
    const paths = findPositionFields({
      opts: { position: { x: 100, y: 200 } },
      nodes: [{ x: 5, y: 7, label: 'n1' }],
      meta: { y: 'not-a-number' },
    });
    expect(paths).toContain('$.opts.position');
    expect(paths).toContain('$.nodes[0].x');
    expect(paths).toContain('$.nodes[0].y');
    // string-valued x/y is not a coordinate
    expect(paths).not.toContain('$.meta.y');
    // the position object is flagged at the key, not double-flagged at its leaves
    expect(paths).not.toContain('$.opts.position.x');
  });

  it('fails tool calls carrying position fields in a layout_computed section', () => {
    const norm = normalizeSteps({
      version: 2,
      sections: [
        {
          name: 'layout',
          layout_computed: true,
          calls: [
            {
              tool: 'stage_spec',
              args: { spec: { nodes: [{ key: 'a', position: { x: 1, y: 2 } }] } },
            },
            { tool: 'list_flows' },
          ],
        },
      ],
    });
    const violations = lintSteps(norm);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ section: 'layout', step_index: 0, tool: 'stage_spec' });
    expect(violations[0]!.paths).toContain('$.spec.nodes[0].position');
  });

  it('does NOT lint sections that are not flagged layout_computed (hand layout is legal there)', () => {
    const norm = normalizeSteps({
      version: 2,
      sections: [
        {
          name: 'setup',
          calls: [{ tool: 'add_node', args: { opts: { position: { x: 100, y: 100 } } } }],
        },
      ],
    });
    expect(lintSteps(norm)).toEqual([]);
  });

  it('exec steps in layout_computed sections are not position-linted (no MCP payload)', () => {
    const norm = normalizeSteps({
      version: 2,
      sections: [{ name: 'layout', layout_computed: true, calls: [{ exec: 'echo x=1 y=2' }] }],
    });
    expect(lintSteps(norm)).toEqual([]);
  });
});

describe('createPrevTracker — $PREV poisoning hard-errors (audit 79-call-cascade class)', () => {
  it('resolves nested paths from the parse of the preceding successful call', () => {
    const prev = createPrevTracker();
    prev.record('add_node', { ok: true, data: { staged_hash: 'abc', diff: { nodes_added: 1 } } });
    expect(prev.subst({ h: '$PREV.staged_hash' }, 'deploy')).toEqual({ h: 'abc' });
    expect(prev.subst('$PREV.diff.nodes_added', 'x')).toBe(1);
    expect(prev.subst('$PREV', 'x')).toEqual({ staged_hash: 'abc', diff: { nodes_added: 1 } });
  });

  it('substitutes inside arrays and nested objects; non-$PREV values pass through untouched', () => {
    const prev = createPrevTracker();
    prev.record('t', { ok: true, data: { ids: ['a', 'b'] } });
    expect(prev.subst([{ v: '$PREV.ids.1' }, 'plain', 42], 'x')).toEqual([{ v: 'b' }, 'plain', 42]);
  });

  it('hard-errors when no tool call has run yet', () => {
    const prev = createPrevTracker();
    expect(() => prev.subst('$PREV.id', 'first')).toThrow(PrevPoisonedError);
    expect(() => prev.subst('$PREV.id', 'first')).toThrow(/no tool call has run yet/);
  });

  it('hard-errors when the preceding call FAILED (the original driver silently used stale data)', () => {
    const prev = createPrevTracker();
    prev.record('get_flow', { ok: true, data: { id: 'tab1' } });
    prev.record('add_node', { ok: false, reason: 'failed (isError)' });
    expect(() => prev.subst('$PREV.id', 'update_node')).toThrow(PrevPoisonedError);
    expect(() => prev.subst('$PREV.id', 'update_node')).toThrow(/'add_node' failed \(isError\)/);
  });

  it('hard-errors when the preceding call returned non-JSON output', () => {
    const prev = createPrevTracker();
    prev.record('render_flow_svg', { ok: false, reason: 'succeeded but returned non-JSON output' });
    expect(() => prev.subst('$PREV.anything', 'x')).toThrow(/non-JSON output/);
  });

  it('hard-errors when a path segment resolves to undefined, naming the segment and available keys', () => {
    const prev = createPrevTracker();
    prev.record('get_staged_change', { ok: true, data: { staged: null, ok: true } });
    expect(() => prev.subst('$PREV.staged.staged_hash', 'deploy')).toThrow(PrevPoisonedError);
    expect(() => prev.subst('$PREV.staged.staged_hash', 'deploy')).toThrow(
      /resolves to undefined at '\$PREV\.staged\.staged_hash'/,
    );
    expect(() => prev.subst('$PREV.nope', 'deploy')).toThrow(/top-level keys: ok, staged/);
  });

  it('values that merely START with $PREV but are not references still resolve as references (no silent literal)', () => {
    const prev = createPrevTracker();
    prev.record('t', { ok: true, data: { x: 1 } });
    // '$PREVIOUS' is NOT a $PREV token (no dot, not exact) — passes through.
    expect(prev.subst('$PREVIOUS', 'x')).toBe('$PREVIOUS');
  });
});

describe('createPrevTracker.substCommand — exec-step $PREV interpolation (EVAL-2 S5 loop)', () => {
  it("interpolates REND-8's after_png path into the Read command (the S5 loop shape)", () => {
    const prev = createPrevTracker();
    prev.record('move_node', {
      ok: true,
      data: { render: { tabs: [{ tab_id: 't1', after_png: '/tmp/renders/stage-t1-after.png' }] } },
    });
    expect(prev.substCommand('od -An -tx1 -N 8 "$PREV.render.tabs.0.after_png"', 'exec:od')).toBe(
      'od -An -tx1 -N 8 "/tmp/renders/stage-t1-after.png"',
    );
  });

  it('interpolates multiple tokens, numbers, and booleans; commands without tokens pass through', () => {
    const prev = createPrevTracker();
    prev.record('t', { ok: true, data: { n: 3, flag: true, name: 'probe' } });
    expect(prev.substCommand('echo $PREV.name $PREV.n $PREV.flag', 'x')).toBe('echo probe 3 true');
    expect(prev.substCommand('echo plain', 'x')).toBe('echo plain');
    // A hyphen ends a token (shell-word ambiguity): '$PREV.name-suffix'
    // resolves '.name' and keeps '-suffix' literal.
    expect(prev.substCommand('echo $PREV.name-suffix', 'x')).toBe('echo probe-suffix');
  });

  it('does NOT half-match $PREV-prefixed identifiers', () => {
    const prev = createPrevTracker();
    prev.record('t', { ok: true, data: { x: 1 } });
    expect(prev.substCommand('echo $PREVENTED', 'x')).toBe('echo $PREVENTED');
  });

  it('poisons exactly like tool-arg substitution: no prior call, failed prior call, undefined path', () => {
    const fresh = createPrevTracker();
    expect(() => fresh.substCommand('cat "$PREV.path"', 'x')).toThrow(PrevPoisonedError);

    const failed = createPrevTracker();
    failed.record('move_node', { ok: false, reason: 'failed (isError)' });
    expect(() => failed.substCommand('cat "$PREV.path"', 'x')).toThrow(/'move_node' failed/);

    const missing = createPrevTracker();
    missing.record('t', { ok: true, data: { render: {} } });
    expect(() => missing.substCommand('cat "$PREV.render.tabs.0.after_png"', 'x')).toThrow(
      /resolves to undefined/,
    );
  });

  it('poisons on non-scalar resolutions — null after_png (rasterizer absent) and objects abort loudly', () => {
    const prev = createPrevTracker();
    prev.record('move_node', { ok: true, data: { render: { tabs: [{ after_png: null }] } } });
    expect(() => prev.substCommand('cat "$PREV.render.tabs.0.after_png"', 'x')).toThrow(
      PrevPoisonedError,
    );
    expect(() => prev.substCommand('cat "$PREV.render.tabs.0.after_png"', 'x')).toThrow(
      /resolved to null/,
    );
    expect(() => prev.substCommand('cat "$PREV.render"', 'x')).toThrow(/resolved to object/);
    expect(() => prev.substCommand('cat "$PREV"', 'x')).toThrow(PrevPoisonedError);
  });
});

describe('parseFlowOtterCmd — FLOW_OTTER_CMD env', () => {
  it('defaults to the built server', () => {
    expect(parseFlowOtterCmd({})).toEqual({
      command: 'node',
      args: ['dist/bin/flow-otter.js'],
    });
  });

  it('splits an override on whitespace', () => {
    expect(
      parseFlowOtterCmd({ FLOW_OTTER_CMD: 'node node_modules/tsx/dist/cli.mjs bin/flow-otter.ts' }),
    ).toEqual({
      command: 'node',
      args: ['node_modules/tsx/dist/cli.mjs', 'bin/flow-otter.ts'],
    });
  });

  it('ignores a blank override', () => {
    expect(parseFlowOtterCmd({ FLOW_OTTER_CMD: '   ' })).toEqual({
      command: 'node',
      args: ['dist/bin/flow-otter.js'],
    });
  });
});
