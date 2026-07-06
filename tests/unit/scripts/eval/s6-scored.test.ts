/**
 * EVAL-4 — S6 scored-mode pins.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  notWorse,
  overallDelta,
  ruleDeltas,
  summarizeScores,
} from '../../../../scripts/eval/benchmark/score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../');
const RUNNER = path.join(ROOT, 'scripts/eval/benchmark/run-s6.mjs');
const THRESHOLDS = path.join(ROOT, 'eval/benchmark/thresholds.json');

function readJson<T>(pathname: string): T {
  return JSON.parse(readFileSync(pathname, 'utf8')) as T;
}

function sha256File(pathname: string): string {
  return createHash('sha256').update(readFileSync(pathname)).digest('hex');
}

function runScored(
  args: string[],
  outDir: string,
  timeout = 60_000,
  env: Record<string, string> = {},
) {
  return spawnSync(process.execPath, [RUNNER, '--scored', '--out', outDir, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...env },
  });
}

describe('S6 scoring math', () => {
  it('pins not-worse boundaries and lint deltas', () => {
    expect(overallDelta(0.5, 0.5)).toBe(0);
    expect(notWorse(overallDelta(0.5, 0.5))).toBe(true);
    expect(notWorse(-1e-6)).toBe(false);
    expect(
      ruleDeltas(
        [{ rule: 'layout-wire-crossings', score: 0.5, offender_count: 4 }],
        [{ rule: 'layout-wire-crossings', score: 0.75, offender_count: 2 }],
      ),
    ).toEqual([
      {
        rule: 'layout-wire-crossings',
        baseline_score: 0.5,
        engine_score: 0.75,
        delta: 0.25,
        baseline_offender_count: 4,
        engine_offender_count: 2,
      },
    ]);
  });

  it('aggregates not_worse_rate and fails verdict dimensions independently', () => {
    expect(
      summarizeScores([
        { status: 'scored', not_worse: true, semantics_pass: true },
        { status: 'scored', not_worse: true, semantics_pass: true },
      ]),
    ).toEqual({
      not_worse_rate: 1,
      crashes: 0,
      semantics_pass_all: true,
      verdict: 'PASS',
    });

    expect(
      summarizeScores([
        { status: 'scored', not_worse: true, semantics_pass: true },
        { status: 'crashed' },
      ]).verdict,
    ).toBe('FAIL');
    expect(
      summarizeScores([{ status: 'scored', not_worse: true, semantics_pass: false }]).verdict,
    ).toBe('FAIL');
    expect(
      summarizeScores([
        { status: 'scored', not_worse: true, semantics_pass: true },
        { status: 'scored', not_worse: false, semantics_pass: true },
      ]),
    ).toMatchObject({ not_worse_rate: 0.5, verdict: 'FAIL' });
  });
});

describe('run-s6.mjs --scored', () => {
  it('keeps scored-mode blind packet and answer key deterministic for a seed', () => {
    const first = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-determinism-a-'));
    const second = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-determinism-b-'));
    try {
      const args = ['--engine', 'identity-stub', '--seed', 'same-seed'];
      const a = runScored(args, first);
      const b = runScored(args, second);

      expect([0, 1]).toContain(a.status);
      expect([0, 1]).toContain(b.status);
      expect(readFileSync(path.join(first, 's6-blind-packet.json'), 'utf8')).toBe(
        readFileSync(path.join(second, 's6-blind-packet.json'), 'utf8'),
      );
      expect(readFileSync(path.join(first, 's6-answer-key.json'), 'utf8')).toBe(
        readFileSync(path.join(second, 's6-answer-key.json'), 'utf8'),
      );
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  }, 60_000);

  it('runs the real layout-toolkit engine and writes the scored record shape', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-happy-'));
    try {
      const res = runScored(['--seed', 'happy-seed'], outDir, 90_000);
      const output = `${res.stdout}\n${res.stderr}`;

      expect([0, 1]).toContain(res.status);
      expect(output).not.toContain('S6 freeze verification FAILED');

      const record = readJson<{
        mode: string;
        engine: string;
        engine_version: string;
        thresholds_sha: string;
        entries: Array<{
          id: string;
          leg: string;
          status: string;
          layout_lint?: { overall: number };
          baseline_lint?: { overall: number };
          raw_metrics?: unknown;
        }>;
        summary: { verdict: 'PASS' | 'FAIL' };
      }>(path.join(outDir, 's6-run-record.json'));
      expect(res.status).toBe(record.summary.verdict === 'PASS' ? 0 : 1);
      expect(record.mode).toBe('scored');
      expect(record.engine).toBe('layout-toolkit');
      expect(record.engine_version).toMatch(/^\d+\.\d+\.\d+/u);
      expect(record.thresholds_sha).toMatch(/^[0-9a-f]{64}$/u);
      expect(record.entries.map((entry) => `${entry.id}:${entry.leg}`).sort()).toEqual([
        'audit-2026-06-10-e1:A',
        'audit-2026-06-10-e1:B',
        'audit-2026-06-10-e2:A',
        'audit-2026-06-10-e2:B',
      ]);
      for (const entry of record.entries) {
        expect(['scored', 'crashed']).toContain(entry.status);
        if (entry.status === 'scored') {
          expect(entry.baseline_lint?.overall).toEqual(expect.any(Number));
          expect(entry.layout_lint?.overall).toEqual(expect.any(Number));
          expect(entry.raw_metrics).toEqual(expect.any(Object));
        }
      }

      const packet = readJson<{ entries: Array<{ packet_id: string }> }>(
        path.join(outDir, 's6-blind-packet.json'),
      );
      for (const entry of packet.entries) {
        expect(existsSync(path.join(outDir, 'artifacts', entry.packet_id, 'left.svg'))).toBe(true);
        expect(existsSync(path.join(outDir, 'artifacts', entry.packet_id, 'right.svg'))).toBe(true);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 90_000);

  it('honors scored threshold supersession and still refuses a wrong superseded sha', () => {
    const acceptedOut = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-superseded-ok-'));
    const refusedOut = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-superseded-bad-'));
    const seamDir = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-superseded-seam-'));
    try {
      const thresholdsCopy = path.join(seamDir, 'thresholds.json');
      copyFileSync(THRESHOLDS, thresholdsCopy);
      writeFileSync(thresholdsCopy, `${readFileSync(thresholdsCopy, 'utf8')}\n`);
      const actualSha = sha256File(thresholdsCopy);

      const accepted = runScored(
        ['--engine', 'identity-stub', '--superseded-thresholds', actualSha],
        acceptedOut,
        60_000,
        { FLOWOTTER_S6_THRESHOLDS: thresholdsCopy },
      );
      const acceptedOutput = `${accepted.stdout}\n${accepted.stderr}`;

      expect([0, 1]).toContain(accepted.status);
      expect(acceptedOutput).not.toContain('S6 freeze verification FAILED');
      expect(acceptedOutput).toContain('superseded-thresholds');
      expect(acceptedOutput).toContain('Recent commits touching eval/benchmark/thresholds.json:');
      const record = readJson<{
        thresholds_superseded: boolean;
        thresholds_superseded_sha: string;
      }>(path.join(acceptedOut, 's6-run-record.json'));
      expect(record.thresholds_superseded).toBe(true);
      expect(record.thresholds_superseded_sha).toBe(actualSha);

      const refused = runScored(
        [
          '--engine',
          'identity-stub',
          '--superseded-thresholds',
          '0000000000000000000000000000000000000000000000000000000000000000',
        ],
        refusedOut,
        60_000,
        { FLOWOTTER_S6_THRESHOLDS: thresholdsCopy },
      );
      const refusedOutput = `${refused.stdout}\n${refused.stderr}`;

      expect(refused.status).toBe(1);
      expect(refusedOutput).toContain('S6 freeze verification FAILED');
      expect(existsSync(path.join(refusedOut, 's6-run-record.json'))).toBe(false);
    } finally {
      rmSync(acceptedOut, { recursive: true, force: true });
      rmSync(refusedOut, { recursive: true, force: true });
      rmSync(seamDir, { recursive: true, force: true });
    }
  }, 60_000);
});
