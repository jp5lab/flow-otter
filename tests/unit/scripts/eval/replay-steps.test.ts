/**
 * EVAL-5 — pins on the audit replay regression suite:
 * scripts/eval/replay/budgets.json plus the e2/e1 steps files consumed by
 * npm run eval:replay. These are phase gates, so loosening a budget or
 * dropping the e1-phase2 zero-coordinate lint flag must be loud.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  findPositionFields,
  lintSteps,
  normalizeSteps,
  type NormalizedSection,
  type NormalizedSteps,
  type NormalizedStep,
} from '../../../../scripts/eval/driver.mjs';
import {
  REPLAY_SCENARIOS,
  S5_DELEGATION,
  parseArgs,
  safetyPostConditions,
  selectedScenarioKeys,
  wiringIdentityPostCondition,
} from '../../../../scripts/eval/replay/replay.mjs';
import { StageChangesOpSchema } from '../../../../src/server/tools/author/op-schemas.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPLAY_DIR = path.resolve(HERE, '../../../../scripts/eval/replay');

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(REPLAY_DIR, file), 'utf8')) as unknown;
}

function loadNormalized(file: string): NormalizedSteps {
  return normalizeSteps(readJson(file));
}

function section(steps: NormalizedSteps, name: string): NormalizedSection {
  const s = steps.sections.find((x) => x.name === name);
  expect(s, `section '${name}' missing`).toBeDefined();
  return s!;
}

function toolSteps(s: NormalizedSection): NormalizedStep[] {
  return s.calls.filter((c) => c.tool !== undefined);
}

describe('EVAL-5 replay budgets.json', () => {
  it('pins the phase-gated budget numbers exactly', () => {
    expect(readJson('budgets.json')).toEqual({
      e2: {
        phase1: {
          max_mcp_calls: 5,
          max_deploy_confirmations: 1,
          max_failed: 0,
          max_force: 0,
          max_oob: 0,
        },
      },
      e1: {
        phase1: {
          max_mcp_calls: 30,
          max_deploy_confirmations: 3,
          max_failed: 0,
        },
        phase2: {
          max_authoring_calls: 3,
          deploy_confirmations: 1,
        },
      },
    });
  });
});

describe('EVAL-5 e2 replay steps', () => {
  it('is schema-v2 valid and passes the driver anti-gaming lint', () => {
    const steps = loadNormalized('e2-steps.json');
    expect(steps.version).toBe(2);
    expect(steps.env).toEqual({});
    expect(lintSteps(steps)).toEqual([]);
  });

  it('keeps setup/read-discovery unbudgeted and budgets only the authoring loop', () => {
    const steps = loadNormalized('e2-steps.json');
    expect(steps.sections.map((s) => s.name)).toEqual([
      'setup-read-discovery',
      'budgeted-authoring',
      'post-deploy-verify',
    ]);
    expect(section(steps, 'setup-read-discovery').budget).toBeNull();
    expect(section(steps, 'post-deploy-verify').budget).toBeNull();
    expect(section(steps, 'budgeted-authoring').budget).toEqual({
      max_mcp_calls: 5,
      max_deploy_confirmations: 1,
      max_failed: 0,
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 0,
    });
  });

  it('realizes the WSB-5 one-batch e2 reorganization: stage_changes -> preview -> hash read -> consented deploy', () => {
    const authoring = section(loadNormalized('e2-steps.json'), 'budgeted-authoring');
    expect(authoring.calls.map((c) => c.tool)).toEqual([
      'stage_changes',
      'preview_flow_diff',
      'get_staged_change',
      'deploy_staged_change',
    ]);
    expect(toolSteps(authoring)).toHaveLength(4);
    expect(toolSteps(authoring).length).toBeLessThanOrEqual(5);

    const deploy = authoring.calls[3]!;
    expect(deploy.elicitation).toBe('accept');
    expect(deploy.args).toEqual({ staged_hash: '$PREV.staged.staged_hash' });
    expect(deploy.expect?.match).toContain('"snapshot_before": "');
  });

  it('authors e2 against the published stage_changes op vocabulary, with move normalized to tab_id', () => {
    const stage = section(loadNormalized('e2-steps.json'), 'budgeted-authoring').calls[0]!;
    const ops = (stage.args as { ops: unknown[] }).ops;
    expect(ops).toHaveLength(21);
    for (const op of ops) {
      expect(() => StageChangesOpSchema.parse(op)).not.toThrow();
      expect((op as Record<string, unknown>)['source_tab_id']).toBeUndefined();
    }
    const moveOps = ops.filter((op) => (op as { op?: unknown }).op === 'move_node');
    expect(moveOps).toHaveLength(12);
    for (const op of moveOps) {
      expect((op as { tab_id?: unknown }).tab_id).toBe('e2spag001');
    }
    expect(ops.map((op) => (op as { op?: string }).op)).toContain('add_group');
    expect(ops.map((op) => (op as { op?: string }).op)).toContain('add_comment');
  });
});

describe('EVAL-5 e1 phase-1 replay steps', () => {
  it('is schema-v2 valid, uncomputed-layout, and safety-pinned', () => {
    const steps = loadNormalized('e1-phase1-steps.json');
    expect(steps.version).toBe(2);
    expect(lintSteps(steps)).toEqual([]);
    expect(steps.sections.every((s) => s.layout_computed === false)).toBe(true);
    expect(steps.sections.map((s) => s.name)).toEqual([
      'setup-read-discovery',
      'proposal-authoring',
      'post-deploy-verify',
    ]);
  });

  it('pins the e1 phase-1 proposal ceiling at 30 MCP calls / 3 confirmations / 0 failed', () => {
    const authoring = section(loadNormalized('e1-phase1-steps.json'), 'proposal-authoring');
    expect(authoring.budget).toEqual({
      max_mcp_calls: 30,
      max_deploy_confirmations: 3,
      max_failed: 0,
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 0,
    });
    expect(toolSteps(authoring)).toHaveLength(6);
    expect(authoring.calls.filter((c) => c.tool === 'deploy_staged_change')).toHaveLength(3);
    for (const deploy of authoring.calls.filter((c) => c.tool === 'deploy_staged_change')) {
      expect(deploy.elicitation).toBe('accept');
      expect(deploy.args).toEqual({ staged_hash: '$PREV.staged_hash' });
      expect(deploy.expect?.match).toContain('"snapshot_before": "');
    }
  });
});

describe('EVAL-5 e1 phase-2 expected-fail replay steps', () => {
  it('is schema-v2 valid and arms layout_computed anti-gaming lint', () => {
    const steps = loadNormalized('e1-phase2-steps.json');
    expect(steps.version).toBe(2);
    expect(lintSteps(steps)).toEqual([]);
    expect(steps.sections.map((s) => s.name)).toEqual([
      'setup-read-discovery',
      'layout-spec-authoring',
    ]);
    expect(section(steps, 'layout-spec-authoring').layout_computed).toBe(true);
  });

  it('keeps the computed-layout authoring payload position-free', () => {
    const authoring = section(loadNormalized('e1-phase2-steps.json'), 'layout-spec-authoring');
    expect(findPositionFields(authoring.calls.map((c) => c.args ?? {}))).toEqual([]);
    expect(authoring.calls).toHaveLength(1);
    expect(authoring.calls[0]!.tool).toBe('stage_spec');
    expect(authoring.calls[0]!.expect).toEqual({ error: false, match: '"staged_hash"' });
  });

  it('keeps the current placeholder under the future e1 phase-2 authoring-call ceiling', () => {
    const budget = (
      readJson('budgets.json') as {
        e1: { phase2: { max_authoring_calls: number; deploy_confirmations: number } };
      }
    ).e1.phase2;
    const authoring = section(loadNormalized('e1-phase2-steps.json'), 'layout-spec-authoring');
    const authoringCalls = authoring.calls.filter(
      (c) => c.tool !== undefined && c.tool !== 'deploy_staged_change',
    );
    expect(authoringCalls).toHaveLength(1);
    expect(authoringCalls.length).toBeLessThanOrEqual(budget.max_authoring_calls);
    expect(budget.deploy_confirmations).toBe(1);
  });
});

describe('EVAL-5 replay runner helpers', () => {
  it('selects the documented default scenarios and marks e1 phase 2 expected-fail by default', () => {
    const opts = parseArgs([]);
    expect(selectedScenarioKeys(opts)).toEqual(['e2:1', 'e1:1', 'e1:2']);
    expect(REPLAY_SCENARIOS['e2:1'].wiringIdentity).toBe(true);
    expect(REPLAY_SCENARIOS['e1:2'].expectFailDefault).toBe(true);
    expect(selectedScenarioKeys(parseArgs(['--scenario', 'e2', '--phase', '1']))).toEqual(['e2:1']);
  });

  it('documents S5 delegation to EVAL-2 instead of copying the steps file', () => {
    expect(S5_DELEGATION.command).toBe('npm run eval:s5');
    expect(S5_DELEGATION.steps_file.endsWith('scripts/eval/steps/s5-steps.json')).toBe(true);
  });

  it('derives replay safety post-conditions from driver JSONL lines', () => {
    const conditions = safetyPostConditions([
      {
        step: 'deploy_staged_change',
        isError: false,
        result: JSON.stringify({ ok: true, snapshot_before: 'snap-1' }),
      },
      {
        step: 'done',
        totals: {
          deploy_confirmations: 1,
          force_uses: 0,
          force_takeover_uses: 0,
        },
      },
    ]);
    expect(conditions.every((c) => c.pass)).toBe(true);

    const missingSnapshot = safetyPostConditions([
      {
        step: 'deploy_staged_change',
        isError: false,
        result: JSON.stringify({ ok: true, snapshot_before: null }),
      },
      {
        step: 'done',
        totals: {
          deploy_confirmations: 1,
          force_uses: 0,
          force_takeover_uses: 0,
        },
      },
    ]);
    expect(missingSnapshot.find((c) => c.name.includes('snapshot_before'))?.pass).toBe(false);
  });

  it('emits the e2 wiring-map post-condition only after a successful driver run', () => {
    const baseline = [
      { id: 'tab', type: 'tab', label: 'T' },
      { id: 'n1', type: 'inject', z: 'tab', wires: [['n2']], x: 100, y: 100 },
      { id: 'n2', type: 'debug', z: 'tab', wires: [], x: 300, y: 100 },
    ];
    const reorganized = [
      { id: 'tab', type: 'tab', label: 'T' },
      { id: 'n2', type: 'debug', z: 'tab', wires: [], x: 500, y: 240, g: 'g1' },
      { id: 'n1', type: 'inject', z: 'tab', wires: [['n2']], x: 180, y: 240 },
    ];

    expect(
      wiringIdentityPostCondition({
        enabled: true,
        key: 'e2:1',
        attempt: 1,
        driverStatus: 2,
        baselineFlows: baseline,
        finalFlows: reorganized,
      }),
    ).toBeNull();

    expect(
      wiringIdentityPostCondition({
        enabled: true,
        key: 'e2:1',
        attempt: 1,
        driverStatus: 0,
        baselineFlows: baseline,
        finalFlows: reorganized,
      }),
    ).toEqual({
      name: 'e2:1 run1: wiring-map byte-identical to seeded baseline',
      pass: true,
      expected: 'identical wiring',
      actual: 'identical wiring',
    });
  });
});
