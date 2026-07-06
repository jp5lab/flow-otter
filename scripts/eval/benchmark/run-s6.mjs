#!/usr/bin/env node
/**
 * EVAL-4 — S6 scoring runner and blinded judging packet plumbing
 * (fix plan §3 EVAL-4).
 *
 * Plumbing mode remains a dry-run over the frozen S6 hashes and deterministic
 * packet builder. `--scored` drives manifest×leg rows through the layout
 * adapter seam, records raw metrics plus layout-lint scores, and writes the
 * blinded SVG artifacts for Leg A judging.
 *
 * Exit codes mirror scripts/eval/driver.mjs:
 *   0 = ok; 1 = gate/refusal fail; 2 = abort.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { EXIT_ABORT, EXIT_GATE_FAIL, EXIT_OK } from '../driver.mjs';
import { compareWiring } from '../compare.mjs';
import { buildBlindPack } from './blind-pack.mjs';
import { identityAdapter, layoutToolkitAdapter, resolveAdapter } from './engine-adapter.mjs';
import { sha256File, verifyFreeze } from './freeze.mjs';
import { flowMetrics, stripPositions as stripSpecPositions } from './metrics.mjs';
import { notWorse, overallDelta, ruleDeltas, summarizeScores } from './score.mjs';

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
const SCORE_EPSILON = 1e-9;

function distUrl(path) {
  return pathToFileURL(join(REPO_ROOT, path)).href;
}

function parseArgs(argv) {
  const opts = {
    scored: false,
    json: false,
    out: DEFAULT_OUT_DIR,
    seed: DEFAULT_SEED,
    supersededThresholdsSha: undefined,
    engine: undefined,
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
  opts.engine ??= opts.scored ? layoutToolkitAdapter.name : identityAdapter.name;
  if (typeof opts.seed !== 'string' || opts.seed.length === 0) {
    throw new Error('--seed must be a non-empty string');
  }
  return opts;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function benchmarkPaths(env = process.env) {
  // Test seam: these only redirect which files are read. The frozen hash
  // records still come from PROTOCOL.md and DESIGN.md unless those paths are
  // explicitly overridden too.
  return {
    manifestPath: env.FLOWOTTER_S6_MANIFEST ? resolve(env.FLOWOTTER_S6_MANIFEST) : MANIFEST_PATH,
    thresholdsPath: env.FLOWOTTER_S6_THRESHOLDS
      ? resolve(env.FLOWOTTER_S6_THRESHOLDS)
      : THRESHOLDS_PATH,
    protocolPath: env.FLOWOTTER_S6_PROTOCOL ? resolve(env.FLOWOTTER_S6_PROTOCOL) : PROTOCOL_PATH,
    designPath: env.FLOWOTTER_S6_DESIGN ? resolve(env.FLOWOTTER_S6_DESIGN) : DESIGN_PATH,
  };
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

function recentThresholdCommits() {
  try {
    return execFileSync(
      'git',
      ['log', '--oneline', '-n', '10', '--', 'eval/benchmark/thresholds.json'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
  } catch {
    return null;
  }
}

function verifyFixtureEntries(manifest, manifestBaseDir = BENCHMARK_DIR) {
  const checks = [];
  for (const entry of manifest.entries ?? []) {
    if (entry.source?.type !== 'fixture') continue;
    const filePath = resolve(manifestBaseDir, entry.source.path);
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

function supersededThresholdCheck(freeze) {
  return freeze.checks.find(
    (check) => check.file === 'eval/benchmark/thresholds.json' && check.superseded === true,
  );
}

function formatSupersededThresholdCommits() {
  const commits = recentThresholdCommits();
  return `Recent commits touching eval/benchmark/thresholds.json:\n${commits ?? '(unavailable)'}`;
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

async function loadScoredToolkit() {
  const [flowsJson, lint, render, decompileModule, compileModule] = await Promise.all([
    import(distUrl('dist/src/shared/flows-json.js')),
    import(distUrl('dist/src/toolkit/lint/layout-lint.js')),
    import(distUrl('dist/src/toolkit/render/svg.js')),
    import(distUrl('dist/src/toolkit/authoring/decompile.js')),
    import(distUrl('dist/src/toolkit/authoring/compile.js')),
  ]);
  return {
    FlowsJsonSchema: flowsJson.FlowsJsonSchema,
    configByReferenceIds: flowsJson.configByReferenceIds,
    isConfigShapedNode: flowsJson.isConfigShapedNode,
    layoutLint: lint.layoutLint,
    renderSvg: render.renderSvg,
    decompile: decompileModule.decompile,
    compile: compileModule.compile,
  };
}

function fixturePathFor(entry, manifestBaseDir) {
  if (entry.source?.type !== 'fixture') {
    throw new Error(`S6 entry ${entry.id} is not backed by a local fixture`);
  }
  return resolve(manifestBaseDir, entry.source.path);
}

function readFixtureFlows(path, FlowsJsonSchema) {
  const snapshot = readJson(path);
  const flows = snapshot?.flows;
  if (!Array.isArray(flows)) {
    throw new Error(`S6 fixture must be a {flows:[...]} snapshot: ${path}`);
  }
  return FlowsJsonSchema.parse(flows);
}

function normalizeLintReport(report) {
  return {
    overall: report.overall,
    rules: report.rules.map((rule) => ({
      rule: rule.rule,
      score: rule.score,
      weight: rule.weight,
      offender_count: Array.isArray(rule.offenders)
        ? rule.offenders.length
        : (rule.offender_count ?? 0),
    })),
  };
}

function lintBaselineFromThreshold(entry) {
  return {
    overall: entry.overall,
    rules: entry.rules.map((rule) => ({
      rule: rule.rule,
      score: rule.score,
      weight: rule.weight,
      offender_count: rule.offender_count,
    })),
  };
}

function baselineEntriesById(thresholds) {
  return new Map(
    (thresholds.first_benchmark_run?.entries ?? []).map((entry) => [
      entry.id,
      lintBaselineFromThreshold(entry),
    ]),
  );
}

function tabMetrics(flows) {
  return flows
    .filter((node) => node.type === 'tab')
    .map((tab) => ({
      tab_id: tab.id,
      label: tab.label,
      ...flowMetrics(flows, tab.id),
    }));
}

function stripFlowPlacement(flows, toolkit) {
  const configIds = toolkit.configByReferenceIds(flows);
  return flows.map((node) => {
    if (node.type === 'tab' || node.type === 'subflow') return { ...node };
    if (toolkit.isConfigShapedNode(node, configIds)) return { ...node };

    const stripped = { ...node };
    if (stripped.type === 'group') {
      delete stripped.x;
      delete stripped.y;
      delete stripped.w;
      delete stripped.h;
      return stripped;
    }

    if ('x' in stripped || 'y' in stripped) {
      stripped.x = 0;
      stripped.y = 0;
    }
    return stripped;
  });
}

function lintDriftFailures(contexts, toolkit, viewportWindowWidth) {
  const failures = [];
  for (const context of contexts) {
    const actual = normalizeLintReport(
      toolkit.layoutLint(context.fixtureFlows, { viewportWindowWidth }),
    );
    const delta = overallDelta(context.baselineLint.overall, actual.overall);
    if (Math.abs(delta) > SCORE_EPSILON) {
      failures.push({
        id: context.entry.id,
        expected: context.baselineLint.overall,
        actual: actual.overall,
        delta,
      });
    }
  }
  return failures;
}

function scoredRow({ context, leg, legType, laidOutFlows, toolkit, viewportWindowWidth }) {
  const layoutLint = normalizeLintReport(toolkit.layoutLint(laidOutFlows, { viewportWindowWidth }));
  const delta = overallDelta(context.baselineLint.overall, layoutLint.overall);
  const wiring = compareWiring(context.fixtureFlows, laidOutFlows);
  return {
    id: context.entry.id,
    leg,
    leg_type: legType,
    status: 'scored',
    ...(leg === 'B' ? { spec_source: 'derived-zero-coordinate' } : {}),
    baseline_lint: context.baselineLint,
    layout_lint: layoutLint,
    lint_delta: delta,
    not_worse: notWorse(delta),
    semantics_pass: wiring.identical,
    semantics_diff_count: wiring.diffs.length,
    rule_deltas: ruleDeltas(context.baselineLint.rules, layoutLint.rules),
    raw_metrics: { tabs: tabMetrics(laidOutFlows) },
  };
}

function crashedRow({ context, leg, legType, error }) {
  return {
    id: context.entry.id,
    leg,
    leg_type: legType,
    status: 'crashed',
    ...(leg === 'B' ? { spec_source: 'derived-zero-coordinate' } : {}),
    baseline_lint: context.baselineLint,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function runScoredLeg({ context, leg, adapter, toolkit, viewportWindowWidth }) {
  const legType = context.entry.legs?.[leg]?.type ?? 'unknown';
  try {
    let laidOutFlows;
    if (leg === 'A') {
      const stripped = stripFlowPlacement(context.fixtureFlows, toolkit);
      laidOutFlows = toolkit.FlowsJsonSchema.parse(
        await adapter.layout(stripped, { kind: 'flows-json' }),
      );
    } else {
      const strippedSpec = stripSpecPositions(toolkit.decompile(context.fixtureFlows));
      const laidOutSpec = await adapter.layout(strippedSpec, { kind: 'spec' });
      laidOutFlows = toolkit.FlowsJsonSchema.parse(
        toolkit.compile(laidOutSpec, { prior: context.fixtureFlows }).flows,
      );
    }
    return {
      row: scoredRow({ context, leg, legType, laidOutFlows, toolkit, viewportWindowWidth }),
      laidOutFlows,
    };
  } catch (error) {
    return { row: crashedRow({ context, leg, legType, error }), laidOutFlows: undefined };
  }
}

function errorSvg(message) {
  const escaped = String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160"><rect width="640" height="160" fill="#fff5f5"/><text x="24" y="48" font-family="Arial,sans-serif" font-size="18" fill="#8a1f1f">S6 engine output unavailable</text><text x="24" y="84" font-family="Arial,sans-serif" font-size="12" fill="#8a1f1f">${escaped}</text></svg>\n`;
}

function writeSvgArtifacts({ outDir, packet, answerKey, contextsById, legAOutputs, toolkit }) {
  const artifactsDir = join(outDir, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  for (const packetEntry of packet.entries) {
    const key = answerKey[packetEntry.packet_id];
    const context = contextsById.get(key.entryId);
    if (context === undefined) throw new Error(`missing S6 context for ${key.entryId}`);

    const packetDir = join(artifactsDir, packetEntry.packet_id);
    mkdirSync(packetDir, { recursive: true });
    const baselineSvg = toolkit.renderSvg(context.fixtureFlows, { allTabs: true });
    const engineOutput = legAOutputs.get(key.entryId);
    const engineSvg =
      engineOutput === undefined
        ? errorSvg(`Leg A did not produce a scored output for ${key.entryId}.`)
        : toolkit.renderSvg(engineOutput, { allTabs: true });

    const sideA = baselineSvg;
    const sideB = engineSvg;
    writeFileSync(join(packetDir, 'left.svg'), key.left === 'A' ? sideA : sideB);
    writeFileSync(join(packetDir, 'right.svg'), key.right === 'A' ? sideA : sideB);
  }

  return artifactsDir;
}

function formatScoreRow(row) {
  if (row.status === 'crashed') {
    return `${row.id} ${row.leg}: crashed (${row.error})`;
  }
  return `${row.id} ${row.leg}: ${row.baseline_lint.overall.toFixed(12)} -> ${row.layout_lint.overall.toFixed(12)} delta=${row.lint_delta.toFixed(12)} not_worse=${row.not_worse ? 'yes' : 'no'} semantics=${row.semantics_pass ? 'pass' : 'fail'}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pathsForRun = benchmarkPaths();
  const freeze = verifyFreeze({
    thresholdsPath: pathsForRun.thresholdsPath,
    protocolPath: pathsForRun.protocolPath,
    designPath: pathsForRun.designPath,
    supersededThresholdsSha: opts.supersededThresholdsSha,
  });

  if (!freeze.ok) {
    console.error(`S6 freeze verification FAILED:\n${formatFreezeVerdict(freeze)}`);
    process.exit(EXIT_GATE_FAIL);
  }

  const adapter = resolveAdapter(opts.engine);
  const supersededThreshold = opts.scored ? supersededThresholdCheck(freeze) : undefined;

  if (opts.scored) {
    const manifest = readJson(pathsForRun.manifestPath);
    const manifestBaseDir = dirname(pathsForRun.manifestPath);
    const fixtureChecks = verifyFixtureEntries(manifest, manifestBaseDir);
    const fixtureFailures = fixtureChecks.filter((c) => !c.ok);
    if (fixtureFailures.length > 0) {
      console.error(
        `S6 fixture verification FAILED:\n${fixtureFailures
          .map((c) => `${c.id}: expected=${c.expected} actual=${c.actual} file=${c.file}`)
          .join('\n')}`,
      );
      process.exit(EXIT_GATE_FAIL);
    }

    const toolkit = await loadScoredToolkit();
    const thresholds = readJson(pathsForRun.thresholdsPath);
    const viewportWindowWidth = thresholds.first_benchmark_run?.viewport_window_width ?? 1920;
    const baselines = baselineEntriesById(thresholds);
    const contexts = (manifest.entries ?? []).map((entry) => {
      const baselineLint = baselines.get(entry.id);
      if (baselineLint === undefined) {
        throw new Error(`S6 thresholds missing first_benchmark_run entry for ${entry.id}`);
      }
      const fixturePath = fixturePathFor(entry, manifestBaseDir);
      return {
        entry,
        fixturePath,
        fixtureFlows: readFixtureFlows(fixturePath, toolkit.FlowsJsonSchema),
        baselineLint,
      };
    });

    const driftFailures = lintDriftFailures(contexts, toolkit, viewportWindowWidth);
    if (driftFailures.length > 0) {
      console.error(
        `S6 lint drift FAILED:\n${driftFailures
          .map(
            (failure) =>
              `${failure.id}: expected=${failure.expected} actual=${failure.actual} delta=${failure.delta}`,
          )
          .join('\n')}`,
      );
      process.exit(EXIT_GATE_FAIL);
    }

    const { packet, answerKey } = buildBlindPack({
      entries: manifest.entries ?? [],
      seed: opts.seed,
    });
    const rows = [];
    const legAOutputs = new Map();
    for (const context of contexts) {
      for (const leg of ['A', 'B']) {
        const result = await runScoredLeg({
          context,
          leg,
          adapter,
          toolkit,
          viewportWindowWidth,
        });
        rows.push(result.row);
        if (leg === 'A' && result.laidOutFlows !== undefined) {
          legAOutputs.set(context.entry.id, result.laidOutFlows);
        }
      }
    }

    const summary = summarizeScores(rows);
    const packageJson = readJson(PACKAGE_PATH);
    const thresholdsSha = freeze.checks.find(
      (c) => c.file === 'eval/benchmark/thresholds.json',
    ).actual;
    const record = {
      schema_version: 1,
      mode: 'scored',
      version: packageJson.version,
      commit: currentCommit(),
      engine: adapter.name,
      engine_version: adapter.version,
      thresholds_sha: thresholdsSha,
      ...(supersededThreshold !== undefined
        ? { thresholds_superseded: true, thresholds_superseded_sha: supersededThreshold.actual }
        : {}),
      seed: opts.seed,
      viewport_window_width: viewportWindowWidth,
      entries: rows,
      summary,
    };
    const paths = writeOutputs({ outDir: opts.out, packet, answerKey, record });
    paths.artifacts = writeSvgArtifacts({
      outDir: opts.out,
      packet,
      answerKey,
      contextsById: new Map(contexts.map((context) => [context.entry.id, context])),
      legAOutputs,
      toolkit,
    });

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            ok: summary.verdict === 'PASS',
            mode: record.mode,
            engine: record.engine,
            engine_version: record.engine_version,
            summary,
            outputs: paths,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`S6 scored run complete (${rows.length} manifest×leg rows).`);
      console.log(formatFreezeVerdict(freeze));
      if (supersededThreshold !== undefined) {
        console.log(formatSupersededThresholdCommits());
      }
      console.log(`Fixtures verified: ${fixtureChecks.length}`);
      for (const row of rows) console.log(formatScoreRow(row));
      console.log(
        `S6 scored verdict: ${summary.verdict} (not_worse_rate=${summary.not_worse_rate}, crashes=${summary.crashes}, semantics_pass_all=${summary.semantics_pass_all})`,
      );
      console.log(`Packet: ${paths.packet}`);
      console.log(`Answer key: ${paths.answerKey}`);
      console.log(`Artifacts: ${paths.artifacts}`);
      console.log(`Run record: ${paths.record}`);
    }
    process.exit(summary.verdict === 'PASS' ? EXIT_OK : EXIT_GATE_FAIL);
  }

  const manifest = readJson(pathsForRun.manifestPath);
  const fixtureChecks = verifyFixtureEntries(manifest, dirname(pathsForRun.manifestPath));
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
