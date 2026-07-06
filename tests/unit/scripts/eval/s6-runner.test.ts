/**
 * EVAL-4-skeleton — S6 runner CLI plumbing pins.
 */
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../');
const RUNNER = path.join(ROOT, 'scripts/eval/benchmark/run-s6.mjs');
const THRESHOLDS = path.join(ROOT, 'eval/benchmark/thresholds.json');

function readJson(pathname: string): unknown {
  return JSON.parse(readFileSync(pathname, 'utf8'));
}

describe('run-s6.mjs', () => {
  it('writes a plumbing run record, blind packet, and separate answer key', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-runner-'));
    try {
      const res = spawnSync(process.execPath, [RUNNER, '--out', outDir, '--seed', 'unit-seed'], {
        cwd: ROOT,
        encoding: 'utf8',
      });

      expect(res.status).toBe(0);
      const record = readJson(path.join(outDir, 's6-run-record.json')) as {
        schema_version: number;
        mode: string;
        version: string;
        commit: string | null;
        engine: string;
        thresholds_sha: string;
        seed: string;
        entries: { id: string; leg: string; status: string; reason: string }[];
      };
      const packetText = readFileSync(path.join(outDir, 's6-blind-packet.json'), 'utf8');
      const answerKey = readJson(path.join(outDir, 's6-answer-key.json'));

      expect(record.schema_version).toBe(1);
      expect(record.mode).toBe('plumbing');
      expect(record.version).toMatch(/^\d+\.\d+\.\d+/u);
      expect(record.commit === null || /^[0-9a-f]{40}$/u.test(record.commit)).toBe(true);
      expect(record.engine).toBe('identity-stub');
      expect(record.thresholds_sha).toMatch(/^[0-9a-f]{64}$/u);
      expect(record.seed).toBe('unit-seed');
      expect(record.entries).toHaveLength(4);
      expect(record.entries.filter((e) => e.leg === 'A').every((e) => e.status === 'pending')).toBe(
        true,
      );
      expect(
        record.entries.filter((e) => e.leg === 'B').every((e) => e.reason === 'pending-layo-2'),
      ).toBe(true);
      expect(packetText).not.toContain('answerKey');
      expect(packetText).not.toContain('unit-seed');
      expect(answerKey).toEqual(expect.any(Object));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('refuses scored mode on thresholds hash mismatch before writing a run record', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-refusal-out-'));
    const seamDir = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-refusal-seam-'));
    try {
      const thresholdsCopy = path.join(seamDir, 'thresholds.json');
      copyFileSync(THRESHOLDS, thresholdsCopy);
      writeFileSync(thresholdsCopy, `${readFileSync(thresholdsCopy, 'utf8')}\n`);

      const res = spawnSync(process.execPath, [RUNNER, '--scored', '--out', outDir], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, FLOWOTTER_S6_THRESHOLDS: thresholdsCopy },
      });
      const output = `${res.stdout}\n${res.stderr}`;

      expect(res.status).toBe(1);
      expect(output).toContain('S6 freeze verification FAILED');
      expect(output).toContain('eval/benchmark/thresholds.json: FAIL');
      expect(existsSync(path.join(outDir, 's6-run-record.json'))).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(seamDir, { recursive: true, force: true });
    }
  });
});
