/**
 * EVAL-1 — every counting rule of the eval-driver budget account, pinned.
 * The budget glossary in docs/EVALUATION.md documents these rules; this
 * suite is what makes them mechanical instead of aspirational (fix plan §1
 * derives friction gates from this account).
 */
import { describe, expect, it } from 'vitest';

import {
  BUDGET_KEY_TO_COUNTER,
  checkBudget,
  COUNTER_KEYS,
  countElicitation,
  countExecStep,
  countMcpCall,
  newCounters,
  sumCounters,
} from '../../../../scripts/eval/budget.mjs';

describe('newCounters', () => {
  it('starts every counter at zero and exposes exactly the documented keys', () => {
    const c = newCounters();
    expect(Object.keys(c).sort()).toEqual([...COUNTER_KEYS].sort());
    for (const key of COUNTER_KEYS) expect(c[key]).toBe(0);
  });
});

describe('countMcpCall', () => {
  it('counts every MCP call in mcp_calls AND total_invocations', () => {
    const c = newCounters();
    countMcpCall(c);
    countMcpCall(c);
    expect(c.mcp_calls).toBe(2);
    expect(c.total_invocations).toBe(2);
    expect(c.failed).toBe(0);
    expect(c.exec_steps).toBe(0);
  });

  it('counts failed calls (isError or threw) in failed — including expected failures', () => {
    const c = newCounters();
    countMcpCall(c, { failed: true });
    countMcpCall(c, { failed: false });
    expect(c.failed).toBe(1);
    expect(c.mcp_calls).toBe(2);
  });

  it('counts top-level force:true in force_uses', () => {
    const c = newCounters();
    countMcpCall(c, { args: { force: true } });
    countMcpCall(c, { args: { force: false } });
    countMcpCall(c, { args: {} });
    expect(c.force_uses).toBe(1);
  });

  it('counts top-level force_takeover:true in force_takeover_uses', () => {
    const c = newCounters();
    countMcpCall(c, { args: { force_takeover: true } });
    countMcpCall(c, { args: { force_takeover: false } });
    expect(c.force_takeover_uses).toBe(1);
  });

  it('counts the scripted-client consent path (top-level confirm:true) as a deploy confirmation', () => {
    const c = newCounters();
    countMcpCall(c, { args: { staged_hash: 'abc', confirm: true } });
    expect(c.deploy_confirmations).toBe(1);
  });

  it('force:true does NOT count as a deploy confirmation (it counts in force_uses; gates hold max_force:0)', () => {
    const c = newCounters();
    countMcpCall(c, { args: { staged_hash: 'abc', force: true } });
    expect(c.deploy_confirmations).toBe(0);
    expect(c.force_uses).toBe(1);
  });

  it('only TOP-LEVEL flags count — nested force/confirm are payload data, not consent', () => {
    const c = newCounters();
    countMcpCall(c, { args: { opts: { force: true, confirm: true, force_takeover: true } } });
    expect(c.force_uses).toBe(0);
    expect(c.deploy_confirmations).toBe(0);
    expect(c.force_takeover_uses).toBe(0);
  });
});

describe('countExecStep', () => {
  it('counts exec steps in exec_steps AND total_invocations, never in mcp_calls', () => {
    const c = newCounters();
    countExecStep(c);
    expect(c.exec_steps).toBe(1);
    expect(c.total_invocations).toBe(1);
    expect(c.mcp_calls).toBe(0);
  });

  it('total_invocations = mcp_calls + exec_steps (the S5 "total invocations" basis)', () => {
    const c = newCounters();
    countMcpCall(c);
    countMcpCall(c);
    countExecStep(c);
    expect(c.total_invocations).toBe(3);
    expect(c.total_invocations).toBe(c.mcp_calls + c.exec_steps);
  });

  it('mutates:true counts an out-of-band mutation', () => {
    const c = newCounters();
    countExecStep(c, { mutates: true });
    countExecStep(c, { mutates: false });
    countExecStep(c);
    expect(c.oob_mutations).toBe(1);
    expect(c.exec_steps).toBe(3);
  });
});

describe('countElicitation', () => {
  it('accept counts a deploy confirmation', () => {
    const c = newCounters();
    countElicitation(c, 'accept');
    expect(c.deploy_confirmations).toBe(1);
    expect(c.elicitation_declines).toBe(0);
  });

  it('decline and cancel count elicitation declines', () => {
    const c = newCounters();
    countElicitation(c, 'decline');
    countElicitation(c, 'cancel');
    expect(c.elicitation_declines).toBe(2);
    expect(c.deploy_confirmations).toBe(0);
  });

  it('unknown actions throw (never silently uncounted)', () => {
    const c = newCounters();
    expect(() => countElicitation(c, 'maybe')).toThrow(/unknown action/);
  });
});

describe('checkBudget', () => {
  it('every documented budget key binds to a real counter', () => {
    for (const counter of Object.values(BUDGET_KEY_TO_COUNTER)) {
      expect(COUNTER_KEYS).toContain(counter);
    }
    // and every counter is reachable through some budget key
    expect(new Set(Object.values(BUDGET_KEY_TO_COUNTER)).size).toBe(COUNTER_KEYS.length);
  });

  it('boundary: actual === limit PASSES; actual === limit + 1 violates', () => {
    const c = newCounters();
    countMcpCall(c);
    countMcpCall(c);
    expect(checkBudget(c, { max_mcp_calls: 2 })).toEqual([]);
    const violations = checkBudget(c, { max_mcp_calls: 1 });
    expect(violations).toEqual([
      { budget_key: 'max_mcp_calls', counter: 'mcp_calls', limit: 1, actual: 2 },
    ]);
  });

  it('zero budgets bind: max_failed:0 / max_force:0 / max_oob:0 catch a single occurrence', () => {
    const c = newCounters();
    countMcpCall(c, { failed: true, args: { force: true } });
    countExecStep(c, { mutates: true });
    const violations = checkBudget(c, { max_failed: 0, max_force: 0, max_oob: 0 });
    expect(violations.map((v) => v.budget_key).sort()).toEqual([
      'max_failed',
      'max_force',
      'max_oob',
    ]);
  });

  it('multiple violations are all reported, not just the first', () => {
    const c = newCounters();
    countMcpCall(c, { failed: true });
    countMcpCall(c, { failed: true });
    const violations = checkBudget(c, { max_mcp_calls: 1, max_failed: 0 });
    expect(violations).toHaveLength(2);
  });

  it('unknown budget keys THROW — a typo must never silently unbind a gate', () => {
    const c = newCounters();
    expect(() => checkBudget(c, { max_mcp_callz: 5 })).toThrow(
      /unknown budget key 'max_mcp_callz'/,
    );
  });

  it('non-integer and negative limits throw', () => {
    const c = newCounters();
    expect(() => checkBudget(c, { max_mcp_calls: 1.5 })).toThrow(/non-negative integer/);
    expect(() => checkBudget(c, { max_mcp_calls: -1 })).toThrow(/non-negative integer/);
    expect(() => checkBudget(c, { max_mcp_calls: '5' as unknown as number })).toThrow(
      /non-negative integer/,
    );
  });

  it('null/undefined budget means unbudgeted (no violations)', () => {
    const c = newCounters();
    countMcpCall(c);
    expect(checkBudget(c, null)).toEqual([]);
    expect(checkBudget(c, undefined)).toEqual([]);
  });
});

describe('sumCounters', () => {
  it('sums per-section counters into a run total', () => {
    const a = newCounters();
    countMcpCall(a, { failed: true });
    const b = newCounters();
    countMcpCall(b);
    countExecStep(b, { mutates: true });
    const total = sumCounters([a, b]);
    expect(total.mcp_calls).toBe(2);
    expect(total.failed).toBe(1);
    expect(total.exec_steps).toBe(1);
    expect(total.total_invocations).toBe(3);
    expect(total.oob_mutations).toBe(1);
  });

  it('does not mutate its inputs', () => {
    const a = newCounters();
    countMcpCall(a);
    sumCounters([a, a]);
    expect(a.mcp_calls).toBe(1);
  });
});
