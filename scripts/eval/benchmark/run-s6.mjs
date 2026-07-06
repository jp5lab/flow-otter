#!/usr/bin/env node
/**
 * EVAL-4-skeleton — S6 scoring runner and blinded judging packet plumbing
 * (fix plan §3 EVAL-4).
 *
 * This is deliberately a plumbing runner only. It verifies the frozen S6
 * hashes, hash-checks manifest fixtures, builds deterministic blind packets,
 * and records manifest×leg run entries behind the LAYO-4 engine adapter seam.
 * It never calls a live layout engine. `--scored` verifies the freeze first,
 * then exits through a distinct not-yet-implemented path until LAYO-4 lands.
 *
 * Exit codes mirror scripts/eval/driver.mjs:
 *   0 = ok; 1 = gate/refusal fail; 2 = abort.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT_ABORT, EXIT_GATE_FAIL, EXIT_OK } from '../driver.mjs';
import { buildBlindPack } from './blind-pack.mjs';
import { identityAdapter, resolveAdapter } from './engine-adapter.mjs';
import { sha256File, verifyFreeze } from './freeze.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BENCHMARK_DIR = join(REPO_ROOT, 'eval', 'benchmark');
const MANIFEST_PATH = join(BENCHMARK_DIR, 'manifest.json');
const THRESHOLDS_PATH = join(BENCHMARK_DIR, 'thresholds.json');
const PROTOCOL_PATH = join(BENCHMARK_DIR, 'PROTOCOL.md');
const DESIGN_PATH = join(REPO_ROOT, 'docs', 'DESIGN.md');
const PACKAGE_PATH = join(REPO_ROOT, 'package.json');
const GITIGNORE_PATH = join(REPO_ROOT, '.gitignore');
const DEFAULT_SEED = 'audit-2026-06-10';
const DEFAULT_OUT_DIR = join(REPO_ROOT, 'eval-results', 's6');

function parseArgs(argv) {
  const opts = {
    scored: false,
    json: false,
    out: DEFAULT_OUT_DIR,
    seed: DEFAULT_SEED,
    supersededThresholdsSha: undefined,
    engine: identityAdapter.name,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scored') opts.scored = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--seed') opts.seed = argv[++i];
    else if (a === '--superseded-thresholds') opts.supersededThresholdsSha = argv[++i];
    else if (a === '--engine') opts.engine = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (typeof opts.seed !== 'string' || opts.seed.length === 0) {
    throw new Error('--seed must be a non-empty string');
  }
  return opts;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function verifyFixtureEntries(manifest) {
  const checks = [];
  for (const entry of manifest.entries ?? []) {
    if (entry.source?.type !== 'fixture') continue;
    const filePath = resolve(BENCHMARK_DIR, entry.source.path);
    const actual = sha256File(filePath);
    checks.push({
      id: entry.id,
      file: filePath,
      expected: entry.source.sha256,
      actual,
      ok: actual === entry.source.sha256,
    });
  }
  return checks;
}

function buildRunEntries(manifest) {
  const rows = [];
  for (const entry of manifest.entries ?? []) {
    for (const leg of ['A', 'B']) {
      const legSpec = entry.legs?.[leg] ?? {};
      if (leg === 'B' && legSpec.spec_status === 'pending-layo-2') {
        rows.push({
          id: entry.id,
          leg,
          status: 'skipped',
          reason: 'pending-layo-2',
        });
      } else {
        rows.push({
          id: entry.id,
          leg,
          status: 'pending',
          reason: 'plumbing-only-no-live-engine',
        });
      }
    }
  }
  return rows;
}

function formatFreezeVerdict(freeze) {
  return freeze.checks
    .map((check) => {
      const status = check.ok ? 'ok' : 'FAIL';
      const superseded = check.superseded === true ? ' superseded-thresholds' : '';
      return `${check.file}: ${status}${superseded} expected=${check.expected} actual=${check.actual}`;
    })
    .join('\n');
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return (
    rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !resolve(child).startsWith('..'))
  );
}

function assertEvalResultsIgnored(outDir) {
  const resolvedOut = resolve(outDir);
  if (!isInside(REPO_ROOT, resolvedOut)) return;

  const evalResultsDir = join(REPO_ROOT, 'eval-results');
  if (!isInside(evalResultsDir, resolvedOut)) {
    throw new Error(
      `answer key output inside the repo must stay under ignored eval-results/: ${resolvedOut}`,
    );
  }
  const gitignore = readFileSync(GITIGNORE_PATH, 'utf8');
  if (!/^eval-results\/?$/mu.test(gitignore)) {
    throw new Error('.gitignore must contain eval-results/ before writing an S6 answer key');
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeOutputs({ outDir, packet, answerKey, record }) {
  assertEvalResultsIgnored(outDir);
  mkdirSync(outDir, { recursive: true });
  const paths = {
    packet: join(outDir, 's6-blind-packet.json'),
    answerKey: join(outDir, 's6-answer-key.json'),
    record: join(outDir, 's6-run-record.json'),
  };
  writeJson(paths.packet, packet);
  writeJson(paths.answerKey, answerKey);
  writeJson(paths.record, record);
  return paths;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const adapter = resolveAdapter(opts.engine);
  const freeze = verifyFreeze({
    thresholdsPath: THRESHOLDS_PATH,
    protocolPath: PROTOCOL_PATH,
    designPath: DESIGN_PATH,
    supersededThresholdsSha: opts.supersededThresholdsSha,
  });

  if (!freeze.ok) {
    console.error(`S6 freeze verification FAILED:\n${formatFreezeVerdict(freeze)}`);
    process.exit(EXIT_GATE_FAIL);
  }

  if (opts.scored) {
    console.error(`S6 freeze verification passed:\n${formatFreezeVerdict(freeze)}`);
    console.error(
      'scored mode not yet implemented (blocked on post-kill-switch engine API, LAYO-4)',
    );
    process.exit(EXIT_ABORT);
  }

  const manifest = readJson(MANIFEST_PATH);
  const fixtureChecks = verifyFixtureEntries(manifest);
  const fixtureFailures = fixtureChecks.filter((c) => !c.ok);
  if (fixtureFailures.length > 0) {
    console.error(
      `S6 fixture verification FAILED:\n${fixtureFailures
        .map((c) => `${c.id}: expected=${c.expected} actual=${c.actual} file=${c.file}`)
        .join('\n')}`,
    );
    process.exit(EXIT_GATE_FAIL);
  }

  const { packet, answerKey } = buildBlindPack({
    entries: manifest.entries ?? [],
    seed: opts.seed,
  });
  const packageJson = readJson(PACKAGE_PATH);
  const thresholdsSha = freeze.checks.find(
    (c) => c.file === 'eval/benchmark/thresholds.json',
  ).actual;
  const record = {
    schema_version: 1,
    mode: 'plumbing',
    version: packageJson.version,
    commit: currentCommit(),
    engine: adapter.name,
    thresholds_sha: thresholdsSha,
    seed: opts.seed,
    entries: buildRunEntries(manifest),
  };
  const paths = writeOutputs({ outDir: opts.out, packet, answerKey, record });

  const summary = {
    ok: true,
    mode: record.mode,
    engine: record.engine,
    freeze,
    fixtures: { checked: fixtureChecks.length },
    outputs: paths,
    entries: record.entries.length,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`S6 skeleton dry-run ok (${record.entries.length} manifest×leg rows).`);
    console.log(formatFreezeVerdict(freeze));
    console.log(`Fixtures verified: ${fixtureChecks.length}`);
    console.log(`Packet: ${paths.packet}`);
    console.log(`Answer key: ${paths.answerKey}`);
    console.log(`Run record: ${paths.record}`);
  }
  process.exit(EXIT_OK);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(existsSync(MANIFEST_PATH) ? EXIT_ABORT : EXIT_GATE_FAIL);
});
