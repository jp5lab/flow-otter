#!/usr/bin/env node
/**
 * EVAL-1 — MCP eval driver. Speaks real MCP (stdio) to the FlowOtter server
 * exactly as an agent client would, with a budget account per section.
 * Promoted (and hardened) from the gitignored eval-results/driver.mjs used
 * in the 2026-06-10 layout audit.
 *
 * Usage:  node scripts/eval/driver.mjs <steps-file.json>
 * Output: one JSON object per step on stdout (JSONL).
 * Server: `node dist/bin/flow-otter.js` by default; override with the
 *         FLOW_OTTER_CMD env var (whitespace-split, e.g.
 *         FLOW_OTTER_CMD="node node_modules/tsx/dist/cli.mjs bin/flow-otter.ts").
 *
 * Steps-file schema v2 (v1 flat `{calls: [...]}` files are auto-wrapped into
 * a single unbudgeted section):
 *
 *   {
 *     "version": 2,
 *     "env": { "NODE_RED_BASE_URL": "http://localhost:1880", ... },
 *     "listTools": true,
 *     "describe": ["tool_name", ...],
 *     "sections": [
 *       {
 *         "name": "loop",
 *         "budget": { "max_total_invocations": 6, "max_failed": 0, ... },
 *         "layout_computed": true,
 *         "calls": [
 *           { "tool": "move_node", "args": {...}, "maxLen": 4000,
 *             "save": "out.json", "elicitation": "accept",
 *             "expect": { "error": false, "match": "staged_hash" } },
 *           { "exec": "shasum out.json", "mutates": false,
 *             "expect": { "match": "..." } },
 *           { "sleep": 500 }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Hard rules (see docs/EVALUATION.md "Budget glossary" — normative):
 * - $PREV poisoning is a HARD ERROR: `$PREV...` may only reference the parse
 *   of the immediately preceding tool call, and that call must have
 *   succeeded and returned JSON; any path segment resolving to undefined
 *   aborts the run (exit 2). Pins the audit's 79-call-cascade class.
 * - Anti-gaming lint: any tool-call payload containing position fields
 *   (`position` keys, numeric `x`/`y`) inside a section flagged
 *   `layout_computed: true` fails the run before any call is made (exit 2).
 * - EPIPE on stdout (downstream pipe closed) exits quietly instead of
 *   crashing mid-run.
 *
 * Exit codes: 0 = all sections within budget and all expectations met;
 * 1 = budget violation or expectation failure; 2 = run aborted (bad steps
 * file, lint failure, $PREV poisoning, connect failure).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import {
  checkBudget,
  countElicitation,
  countExecStep,
  countMcpCall,
  newCounters,
  sumCounters,
} from './budget.mjs';

export const EXIT_OK = 0;
export const EXIT_GATE_FAIL = 1;
export const EXIT_ABORT = 2;

const DEFAULT_FLOW_OTTER_CMD = 'node dist/bin/flow-otter.js';

export class StepsFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StepsFileError';
  }
}

export class PrevPoisonedError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'PrevPoisonedError';
    this.info = info;
  }
}

/** Parse FLOW_OTTER_CMD (whitespace-split) into {command, args}. */
export function parseFlowOtterCmd(env = process.env) {
  const raw = typeof env.FLOW_OTTER_CMD === 'string' ? env.FLOW_OTTER_CMD.trim() : '';
  const spec = raw.length > 0 ? raw : DEFAULT_FLOW_OTTER_CMD;
  const parts = spec.split(/\s+/);
  return { command: parts[0], args: parts.slice(1) };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function assertKnownKeys(obj, known, where) {
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      throw new StepsFileError(
        `${where}: unknown key '${key}' (known: ${[...known].sort().join(', ')}).`,
      );
    }
  }
}

function normalizeExpect(expect, where, { allowError }) {
  if (expect === undefined) return undefined;
  if (!isPlainObject(expect)) throw new StepsFileError(`${where}: 'expect' must be an object.`);
  assertKnownKeys(expect, new Set(['error', 'match', 'not_match']), `${where}.expect`);
  if (expect.error !== undefined) {
    if (!allowError) {
      throw new StepsFileError(`${where}.expect: 'error' is only valid on tool steps.`);
    }
    if (typeof expect.error !== 'boolean') {
      throw new StepsFileError(`${where}.expect: 'error' must be a boolean.`);
    }
  }
  for (const key of ['match', 'not_match']) {
    if (expect[key] === undefined) continue;
    if (typeof expect[key] !== 'string') {
      throw new StepsFileError(`${where}.expect: '${key}' must be a regex string.`);
    }
    try {
      new RegExp(expect[key]);
    } catch (e) {
      throw new StepsFileError(`${where}.expect: '${key}' is not a valid regex: ${e.message}`);
    }
  }
  return expect;
}

function normalizeStep(step, where) {
  if (!isPlainObject(step)) throw new StepsFileError(`${where}: each step must be an object.`);
  const kinds = ['tool', 'exec', 'sleep'].filter((k) => step[k] !== undefined);
  if (kinds.length !== 1) {
    throw new StepsFileError(
      `${where}: a step must have exactly one of 'tool' | 'exec' | 'sleep' (found: ${
        kinds.length === 0 ? 'none' : kinds.join('+')
      }).`,
    );
  }
  if (step.sleep !== undefined) {
    assertKnownKeys(step, new Set(['sleep']), where);
    if (typeof step.sleep !== 'number' || step.sleep <= 0) {
      throw new StepsFileError(`${where}: 'sleep' must be a positive number of milliseconds.`);
    }
    return step;
  }
  if (step.exec !== undefined) {
    assertKnownKeys(step, new Set(['exec', 'mutates', 'save', 'maxLen', 'expect']), where);
    if (typeof step.exec !== 'string' || step.exec.length === 0) {
      throw new StepsFileError(`${where}: 'exec' must be a non-empty string.`);
    }
    if (step.mutates !== undefined && typeof step.mutates !== 'boolean') {
      throw new StepsFileError(`${where}: 'mutates' must be a boolean.`);
    }
    normalizeExpect(step.expect, where, { allowError: false });
    return step;
  }
  assertKnownKeys(
    step,
    new Set(['tool', 'args', 'maxLen', 'save', 'elicitation', 'expect']),
    where,
  );
  if (typeof step.tool !== 'string' || step.tool.length === 0) {
    throw new StepsFileError(`${where}: 'tool' must be a non-empty string.`);
  }
  if (step.args !== undefined && !isPlainObject(step.args)) {
    throw new StepsFileError(`${where}: 'args' must be an object.`);
  }
  if (
    step.elicitation !== undefined &&
    step.elicitation !== 'accept' &&
    step.elicitation !== 'decline'
  ) {
    throw new StepsFileError(`${where}: 'elicitation' must be 'accept' or 'decline'.`);
  }
  normalizeExpect(step.expect, where, { allowError: true });
  return step;
}

/**
 * Normalize a parsed steps file to schema v2. v1 files (flat `calls`, no
 * `sections`) are wrapped into a single unbudgeted section named 'main'.
 * Throws StepsFileError on any malformed shape, unknown key, or unknown
 * budget key (a typo'd budget key would silently never bind — refused).
 */
export function normalizeSteps(raw) {
  if (!isPlainObject(raw)) throw new StepsFileError('steps file must be a JSON object.');
  assertKnownKeys(
    raw,
    new Set(['version', 'env', 'listTools', 'describe', 'calls', 'sections']),
    'steps file',
  );
  if (raw.env !== undefined && !isPlainObject(raw.env)) {
    throw new StepsFileError("steps file: 'env' must be an object.");
  }
  const version = raw.version ?? (raw.sections !== undefined ? 2 : 1);
  if (version !== 1 && version !== 2) {
    throw new StepsFileError(`steps file: unsupported version ${JSON.stringify(raw.version)}.`);
  }
  let sections;
  if (version === 1) {
    if (raw.sections !== undefined) {
      throw new StepsFileError("steps file: version 1 must not have 'sections' (use version 2).");
    }
    sections = [
      {
        name: 'main',
        budget: null,
        layout_computed: false,
        calls: (raw.calls ?? []).map((s, i) => normalizeStep(s, `calls[${i}]`)),
      },
    ];
  } else {
    if (raw.calls !== undefined) {
      throw new StepsFileError(
        "steps file: version 2 must not have top-level 'calls' — put steps in sections.",
      );
    }
    if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
      throw new StepsFileError("steps file: version 2 requires a non-empty 'sections' array.");
    }
    const seen = new Set();
    sections = raw.sections.map((section, si) => {
      const where = `sections[${si}]`;
      if (!isPlainObject(section)) throw new StepsFileError(`${where}: must be an object.`);
      assertKnownKeys(section, new Set(['name', 'budget', 'layout_computed', 'calls']), where);
      if (typeof section.name !== 'string' || section.name.length === 0) {
        throw new StepsFileError(`${where}: 'name' must be a non-empty string.`);
      }
      if (seen.has(section.name)) {
        throw new StepsFileError(`${where}: duplicate section name '${section.name}'.`);
      }
      seen.add(section.name);
      if (section.budget !== undefined && section.budget !== null) {
        if (!isPlainObject(section.budget)) {
          throw new StepsFileError(`${where}: 'budget' must be an object.`);
        }
        try {
          checkBudget(newCounters(), section.budget);
        } catch (e) {
          throw new StepsFileError(`${where}: ${e.message}`);
        }
      }
      if (section.layout_computed !== undefined && typeof section.layout_computed !== 'boolean') {
        throw new StepsFileError(`${where}: 'layout_computed' must be a boolean.`);
      }
      if (!Array.isArray(section.calls)) {
        throw new StepsFileError(`${where}: 'calls' must be an array.`);
      }
      return {
        name: section.name,
        budget: section.budget ?? null,
        layout_computed: section.layout_computed === true,
        calls: section.calls.map((s, i) => normalizeStep(s, `${where}.calls[${i}]`)),
      };
    });
  }
  return {
    version: 2,
    env: raw.env ?? {},
    listTools: raw.listTools === true,
    describe: Array.isArray(raw.describe) ? raw.describe : [],
    sections,
  };
}

/**
 * Recursively find position fields in a payload: any `position` key (any
 * value), and any `x`/`y` key with a numeric value. Returns the paths found.
 */
export function findPositionFields(value, path = '$') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findPositionFields(v, `${path}[${i}]`)));
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const p = `${path}.${k}`;
      if (k === 'position') {
        found.push(p);
        continue; // flagged at the key — don't also flag its x/y leaves
      }
      if ((k === 'x' || k === 'y') && typeof v === 'number') {
        found.push(p);
        continue;
      }
      found.push(...findPositionFields(v, p));
    }
  }
  return found;
}

/**
 * Anti-gaming steps-file lint (fix plan EVAL-1 [Amended: gates blocker]):
 * in any section flagged `layout_computed: true`, NO tool-call payload may
 * carry position fields — the layout must come from the machine, not the
 * steps author. Returns lint violations; any violation fails the run.
 */
export function lintSteps(normalized) {
  const violations = [];
  for (const section of normalized.sections) {
    if (!section.layout_computed) continue;
    section.calls.forEach((step, i) => {
      if (step.tool === undefined) return;
      const paths = findPositionFields(step.args ?? {});
      if (paths.length > 0) {
        violations.push({ section: section.name, step_index: i, tool: step.tool, paths });
      }
    });
  }
  return violations;
}

/**
 * $PREV tracker. `$PREV` / `$PREV.path.to.field` resolve against the parsed
 * JSON of the immediately preceding tool call. Poisoned references — no
 * prior call, prior call failed or returned non-JSON, or a path segment
 * resolving to undefined — throw PrevPoisonedError (hard abort). This pins
 * the 2026-06-10 audit failure class where a silently-undefined `$PREV`
 * substitution after a failed call poisoned two 79-call cascades.
 */
export function createPrevTracker() {
  let state = null; // { step, ok, data?, reason? }

  const resolveToken = (token, stepName) => {
    if (state === null) {
      throw new PrevPoisonedError(
        `step '${stepName}' references '${token}' but no tool call has run yet.`,
      );
    }
    if (!state.ok) {
      throw new PrevPoisonedError(
        `step '${stepName}' references '${token}' but the preceding tool call '${state.step}' ${state.reason}. ` +
          'Refusing to substitute a stale value — fix the steps file (audit 79-call-cascade class).',
        { prev_step: state.step, reason: state.reason },
      );
    }
    if (token === '$PREV') return state.data;
    let cur = state.data;
    const walked = [];
    for (const seg of token.slice('$PREV.'.length).split('.')) {
      walked.push(seg);
      cur = isPlainObject(cur) || Array.isArray(cur) ? cur[seg] : undefined;
      if (cur === undefined) {
        const available = isPlainObject(state.data)
          ? Object.keys(state.data).sort().join(', ')
          : typeof state.data;
        throw new PrevPoisonedError(
          `step '${stepName}': '${token}' resolves to undefined at '$PREV.${walked.join('.')}' ` +
            `(prev step '${state.step}'; top-level keys: ${available}).`,
          { prev_step: state.step, undefined_at: walked.join('.') },
        );
      }
    }
    return cur;
  };

  const subst = (value, stepName) => {
    if (typeof value === 'string' && (value === '$PREV' || value.startsWith('$PREV.'))) {
      return resolveToken(value, stepName);
    }
    if (Array.isArray(value)) return value.map((v) => subst(v, stepName));
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, subst(v, stepName)]));
    }
    return value;
  };

  return {
    /** outcome: {ok: true, data} | {ok: false, reason} */
    record(step, outcome) {
      state = { step, ...outcome };
    },
    subst,
  };
}

function evalExpect(expect, outcome) {
  if (expect === undefined) return [];
  const issues = [];
  if (expect.error !== undefined && outcome.isError !== expect.error) {
    issues.push({ check: 'error', expected: expect.error, actual: outcome.isError });
  }
  if (expect.match !== undefined && !new RegExp(expect.match).test(outcome.text)) {
    issues.push({ check: 'match', pattern: expect.match });
  }
  if (expect.not_match !== undefined && new RegExp(expect.not_match).test(outcome.text)) {
    issues.push({ check: 'not_match', pattern: expect.not_match });
  }
  return issues;
}

/** Build elicitation-accept content from the requested JSON schema: booleans
 * are ALWAYS answered true (an `accept` directive means the affirmative —
 * consent forms deliberately default to false, so the schema default must
 * not win); strings/numbers use their default (or ''/0). Satisfies the
 * deploy consent form `{confirm: true}` generically. */
function buildAcceptContent(requestedSchema) {
  const content = {};
  const properties = isPlainObject(requestedSchema?.properties) ? requestedSchema.properties : {};
  for (const [name, prop] of Object.entries(properties)) {
    if (!isPlainObject(prop)) continue;
    if (prop.type === 'boolean') content[name] = true;
    else if (prop.type === 'number' || prop.type === 'integer') content[name] = prop.default ?? 0;
    else content[name] = prop.default ?? '';
  }
  return content;
}

async function main() {
  // EPIPE guard: downstream pipe (e.g. `| head`) closing must not crash the
  // run mid-flight with an unhandled stream error.
  process.stdout.on('error', (err) => {
    if (err && err.code === 'EPIPE') process.exit(EXIT_OK);
    throw err;
  });
  const out = (o) => console.log(JSON.stringify(o));

  const stepsPath = process.argv[2];
  if (stepsPath === undefined) {
    out({
      step: 'usage',
      aborted: true,
      error: 'usage: node scripts/eval/driver.mjs <steps-file.json>',
    });
    process.exit(EXIT_ABORT);
  }

  let steps;
  try {
    steps = normalizeSteps(JSON.parse(readFileSync(stepsPath, 'utf8')));
  } catch (e) {
    out({ step: 'steps-file', aborted: true, error: String(e?.message ?? e) });
    process.exit(EXIT_ABORT);
  }

  const lintViolations = lintSteps(steps);
  if (lintViolations.length > 0) {
    out({
      step: 'lint',
      aborted: true,
      error:
        'anti-gaming lint: position fields found in layout_computed section(s) — hand-placed coordinates disqualify the run.',
      violations: lintViolations,
    });
    process.exit(EXIT_ABORT);
  }

  const { command, args: cmdArgs } = parseFlowOtterCmd(process.env);
  const transport = new StdioClientTransport({
    command,
    args: cmdArgs,
    env: { ...process.env, ...steps.env },
    stderr: process.env.FLOW_OTTER_DRIVER_STDERR === 'inherit' ? 'inherit' : 'ignore',
  });

  // Elicitation plumbing: the in-flight tool step's directive decides the
  // answer; no directive means decline (never consent by accident).
  let currentElicitation = null;
  let currentCounters = null;
  const client = new Client(
    { name: 'flow-otter-eval-driver', version: '2.0.0' },
    { capabilities: { elicitation: {} } },
  );
  client.setRequestHandler(ElicitRequestSchema, (request) => {
    const directive = currentElicitation;
    const action = directive === 'accept' ? 'accept' : 'decline';
    if (currentCounters !== null) countElicitation(currentCounters, action);
    out({
      step: 'elicitation',
      directive: directive ?? null,
      action,
      message:
        typeof request?.params?.message === 'string' ? request.params.message.slice(0, 200) : null,
    });
    if (action === 'accept') {
      return { action: 'accept', content: buildAcceptContent(request?.params?.requestedSchema) };
    }
    return { action: 'decline' };
  });

  try {
    await client.connect(transport);
  } catch (e) {
    out({ step: 'connect', aborted: true, error: String(e?.message ?? e), command, args: cmdArgs });
    process.exit(EXIT_ABORT);
  }

  // Harness introspection — never budgeted, never counted.
  if (steps.listTools) {
    const { tools } = await client.listTools();
    out({ step: 'tools/list', count: tools.length, names: tools.map((t) => t.name).sort() });
  }
  for (const name of steps.describe) {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === name);
    out({
      step: `describe:${name}`,
      found: t !== undefined,
      schema: t?.inputSchema,
      description: t?.description?.slice(0, 600),
    });
  }

  const prev = createPrevTracker();
  const sectionResults = [];
  const expectFailures = [];
  let abortedReason = null;

  for (const section of steps.sections) {
    const counters = newCounters();
    currentCounters = counters;
    out({
      step: 'section',
      section: section.name,
      ...(section.budget !== null ? { budget: section.budget } : {}),
      ...(section.layout_computed ? { layout_computed: true } : {}),
    });

    for (const [i, s] of section.calls.entries()) {
      if (s.sleep !== undefined) {
        await new Promise((r) => setTimeout(r, s.sleep));
        out({ step: `sleep:${s.sleep}`, section: section.name });
        continue;
      }

      if (s.exec !== undefined) {
        countExecStep(counters, { mutates: s.mutates === true });
        let execOut = '';
        let execFailed = false;
        try {
          execOut = execSync(s.exec, { encoding: 'utf8' });
        } catch (e) {
          execFailed = true;
          execOut = `EXEC FAIL: ${e.message}`;
        }
        if (s.save !== undefined) writeFileSync(s.save, execOut);
        const issues = evalExpect(s.expect, { text: execOut, isError: execFailed });
        for (const issue of issues) {
          expectFailures.push({
            section: section.name,
            step_index: i,
            exec: s.exec.slice(0, 60),
            ...issue,
          });
        }
        out({
          step: `exec:${s.exec.slice(0, 60)}`,
          section: section.name,
          ...(s.mutates === true ? { mutates: true } : {}),
          result: execOut.slice(0, s.maxLen ?? 800),
          ...(issues.length > 0 ? { expect_failed: issues } : {}),
        });
        continue;
      }

      // Tool call step.
      let argsSub;
      try {
        argsSub = prev.subst(s.args ?? {}, s.tool);
      } catch (e) {
        if (e instanceof PrevPoisonedError) {
          abortedReason = `$PREV poisoned: ${e.message}`;
          out({
            step: s.tool,
            section: section.name,
            aborted: true,
            error: abortedReason,
            info: e.info,
          });
          break;
        }
        throw e;
      }

      currentElicitation = s.elicitation ?? null;
      let text = '';
      let failed = false;
      let threw = false;
      try {
        const res = await client.callTool({ name: s.tool, arguments: argsSub });
        text = (res.content ?? [])
          .map((c) => (c.type === 'text' ? c.text : `[${c.type}]`))
          .join('\n');
        failed = res.isError === true;
      } catch (e) {
        threw = true;
        failed = true;
        text = String(e?.message ?? e);
      }
      currentElicitation = null;

      countMcpCall(counters, { failed, args: argsSub });
      if (failed) {
        prev.record(s.tool, {
          ok: false,
          reason: threw ? `threw (${text.slice(0, 120)})` : 'failed (isError)',
        });
      } else {
        let parsed;
        let parsedOk = false;
        try {
          parsed = JSON.parse(text);
          parsedOk = true;
        } catch {
          /* non-JSON result */
        }
        prev.record(
          s.tool,
          parsedOk
            ? { ok: true, data: parsed }
            : { ok: false, reason: 'succeeded but returned non-JSON output' },
        );
      }
      if (s.save !== undefined) writeFileSync(s.save, text);
      const issues = evalExpect(s.expect, { text, isError: failed });
      for (const issue of issues) {
        expectFailures.push({ section: section.name, step_index: i, tool: s.tool, ...issue });
      }
      out({
        step: s.tool,
        section: section.name,
        n: counters.mcp_calls,
        isError: failed,
        ...(threw ? { threw: true } : {}),
        result: text.slice(0, s.maxLen ?? 3500),
        ...(issues.length > 0 ? { expect_failed: issues } : {}),
      });
    }

    currentCounters = null;
    const violations = section.budget !== null ? checkBudget(counters, section.budget) : [];
    sectionResults.push({ name: section.name, counters, violations });
    out({ step: 'section-end', section: section.name, counters, violations });
    if (abortedReason !== null) break;
  }

  const totals = sumCounters(sectionResults.map((r) => r.counters));
  const budgetViolations = sectionResults.flatMap((r) =>
    r.violations.map((v) => ({ section: r.name, ...v })),
  );
  const ok = abortedReason === null && budgetViolations.length === 0 && expectFailures.length === 0;
  const exitCode = abortedReason !== null ? EXIT_ABORT : ok ? EXIT_OK : EXIT_GATE_FAIL;
  out({
    step: 'done',
    ok,
    totals,
    sections: sectionResults,
    budget_violations: budgetViolations,
    expect_failures: expectFailures,
    ...(abortedReason !== null ? { aborted: abortedReason } : {}),
    exit_code: exitCode,
  });
  try {
    await client.close();
  } catch {
    /* server already gone */
  }
  process.exit(exitCode);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}
