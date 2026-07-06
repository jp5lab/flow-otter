/**
 * EVAL-4-skeleton — S6 freeze verification pins.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  readFrozenHashes,
  sha256File,
  verifyFreeze,
} from '../../../../scripts/eval/benchmark/freeze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../');
const BENCHMARK_DIR = path.join(ROOT, 'eval/benchmark');
const THRESHOLDS_PATH = path.join(BENCHMARK_DIR, 'thresholds.json');
const PROTOCOL_PATH = path.join(BENCHMARK_DIR, 'PROTOCOL.md');
const DESIGN_PATH = path.join(ROOT, 'docs/DESIGN.md');
const SHA256_RE = /^[0-9a-f]{64}$/u;

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-s6-freeze-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readFrozenHashes', () => {
  it('parses the frozen threshold and protocol hashes from the real docs', () => {
    const frozen = readFrozenHashes({ protocolPath: PROTOCOL_PATH, designPath: DESIGN_PATH });

    expect(frozen.thresholdsSha).toBe(sha256File(THRESHOLDS_PATH));
    expect(frozen.protocolSha).toBe(sha256File(PROTOCOL_PATH));
    expect(frozen.thresholdsSha).toMatch(SHA256_RE);
    expect(frozen.protocolSha).toMatch(SHA256_RE);
  });

  it('throws when either hash record is missing', () => {
    withTempDir((dir) => {
      const badProtocol = path.join(dir, 'PROTOCOL.md');
      writeFileSync(badProtocol, '# no threshold record\n');
      expect(() =>
        readFrozenHashes({ protocolPath: badProtocol, designPath: DESIGN_PATH }),
      ).toThrow(/Frozen threshold hash/u);

      const badDesign = path.join(dir, 'DESIGN.md');
      writeFileSync(badDesign, '# no design hash record\n');
      expect(() =>
        readFrozenHashes({ protocolPath: PROTOCOL_PATH, designPath: badDesign }),
      ).toThrow(/PROTOCOL\.md sha256 record/u);
    });
  });
});

describe('verifyFreeze', () => {
  it('passes against the real repo files', () => {
    const result = verifyFreeze({
      thresholdsPath: THRESHOLDS_PATH,
      protocolPath: PROTOCOL_PATH,
      designPath: DESIGN_PATH,
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it('reports expected and actual hashes when thresholds are tampered', () => {
    withTempDir((dir) => {
      const thresholdsPath = path.join(dir, 'thresholds.json');
      copyFileSync(THRESHOLDS_PATH, thresholdsPath);
      writeFileSync(thresholdsPath, `${readFileSync(thresholdsPath, 'utf8')}\n`);

      const result = verifyFreeze({
        thresholdsPath,
        protocolPath: PROTOCOL_PATH,
        designPath: DESIGN_PATH,
      });
      const check = result.checks.find((c) => c.file === 'eval/benchmark/thresholds.json')!;

      expect(result.ok).toBe(false);
      expect(check.ok).toBe(false);
      expect(check.expected).toBe(sha256File(THRESHOLDS_PATH));
      expect(check.actual).toBe(sha256File(thresholdsPath));
      expect(check.actual).not.toBe(check.expected);
    });
  });

  it('allows a thresholds supersession only when the supplied sha matches the actual file', () => {
    withTempDir((dir) => {
      const thresholdsPath = path.join(dir, 'thresholds.json');
      copyFileSync(THRESHOLDS_PATH, thresholdsPath);
      writeFileSync(thresholdsPath, `${readFileSync(thresholdsPath, 'utf8')}\n`);
      const actual = sha256File(thresholdsPath);

      const result = verifyFreeze({
        thresholdsPath,
        protocolPath: PROTOCOL_PATH,
        designPath: DESIGN_PATH,
        supersededThresholdsSha: actual,
      });
      const check = result.checks.find((c) => c.file === 'eval/benchmark/thresholds.json')!;

      expect(result.ok).toBe(true);
      expect(check.ok).toBe(true);
      expect(check.superseded).toBe(true);
      expect(check.expected).toBe(sha256File(THRESHOLDS_PATH));
      expect(check.actual).toBe(actual);
    });
  });

  it('never supersedes a PROTOCOL.md hash mismatch', () => {
    withTempDir((dir) => {
      const protocolPath = path.join(dir, 'PROTOCOL.md');
      copyFileSync(PROTOCOL_PATH, protocolPath);
      writeFileSync(protocolPath, `${readFileSync(protocolPath, 'utf8')}\n`);

      const result = verifyFreeze({
        thresholdsPath: THRESHOLDS_PATH,
        protocolPath,
        designPath: DESIGN_PATH,
        supersededThresholdsSha: sha256File(THRESHOLDS_PATH),
      });
      const check = result.checks.find((c) => c.file === 'eval/benchmark/PROTOCOL.md')!;

      expect(result.ok).toBe(false);
      expect(check.ok).toBe(false);
      expect(check.superseded).toBeUndefined();
      expect(check.expected).toBe(sha256File(PROTOCOL_PATH));
      expect(check.actual).toBe(sha256File(protocolPath));
    });
  });
});
