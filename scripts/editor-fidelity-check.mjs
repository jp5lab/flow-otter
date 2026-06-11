#!/usr/bin/env node
/**
 * REND-7 — renderer-fidelity check against the LIVE Node-RED editor
 * (`npm run fidelity:editor`; R3 acceptance, audit F9).
 *
 * Layer B of the fidelity harness (layer A is CI: the REND-3 assertion
 * tests + re-bless protocol in tests/unit/toolkit/render/svg.test.ts and the
 * REND-2 editor-truth pins). This script:
 *
 *   1. Guards fixture freshness: the live editor version must be covered by
 *      a committed tests/fixtures/editor-metrics capture (or the recorded
 *      4.0.x-equals-4.1 assumption) — otherwise the comparison basis is
 *      unvalidated and the run aborts.
 *   2. Deploys the canonical e1 audit fixture (or --flow) to the LOCAL
 *      sterile stack, opens the editor headless over CDP
 *      (scripts/eval/cdp.mjs — the shared zero-new-dependency browser
 *      stack) and captures per-node geometry + port-box centers.
 *   3. Compares against `renderGeometry(flows, tab)` (frozen contract #1)
 *      with the single ±2px comparator (per-corner + per-port,
 *      scripts/eval/fidelity.mjs — also consumed by EVAL-2's eval:s5 leg).
 *
 * Runs under tsx (the npm script) so `renderGeometry` imports from TS
 * source. Talks to localhost only; restores the previously-deployed flows
 * when done (unless --keep-flows).
 *
 * Exit codes (mirrors scripts/eval/driver.mjs): 0 = fidelity pass,
 * 1 = fidelity fail, 2 = abort (stale fixtures, unreachable stack, …).
 *
 * Usage:
 *   npm run fidelity:editor [-- --url http://localhost:1880]
 *       [--flow tests/fixtures/audit-2026-06-10/e1-flows.json] [--tab <id>]
 *       [--chrome "<path>"] [--tolerance 2] [--json /tmp/fidelity.json]
 *       [--screenshot /tmp/editor.png] [--keep-flows]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderGeometry } from '../src/toolkit/render/svg.js';

import { connect, launchChrome } from './eval/cdp.mjs';
import {
  captureEditorGeometry,
  checkFixtureFreshness,
  compareGeometry,
  editorComparableEntries,
  FIDELITY_TOLERANCE_PX,
  formatFidelityReport,
} from './eval/fidelity.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const METRICS_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'editor-metrics');

const EXIT_OK = 0;
const EXIT_FIDELITY_FAIL = 1;
const EXIT_ABORT = 2;

function parseArgs(argv) {
  const opts = {
    url: 'http://localhost:1880',
    flow: join(REPO_ROOT, 'tests', 'fixtures', 'audit-2026-06-10', 'e1-flows.json'),
    tab: undefined,
    chrome: undefined,
    tolerance: FIDELITY_TOLERANCE_PX,
    json: undefined,
    screenshot: undefined,
    keepFlows: false,
    includeGroups: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') opts.url = argv[++i];
    else if (a === '--flow') opts.flow = resolve(argv[++i]);
    else if (a === '--tab') opts.tab = argv[++i];
    else if (a === '--chrome') opts.chrome = argv[++i];
    else if (a === '--tolerance') opts.tolerance = Number(argv[++i]);
    else if (a === '--json') opts.json = resolve(argv[++i]);
    else if (a === '--screenshot') opts.screenshot = resolve(argv[++i]);
    else if (a === '--keep-flows') opts.keepFlows = true;
    else if (a === '--include-groups') opts.includeGroups = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(opts.url)) {
    throw new Error(`--url must be a local Node-RED instance, got: ${opts.url}`);
  }
  if (!Number.isFinite(opts.tolerance) || opts.tolerance < 0) {
    throw new Error('--tolerance must be a non-negative number');
  }
  return opts;
}

async function api(url, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const text = await res.text();
  return text.length > 0 ? JSON.parse(text) : null;
}

/** Same server-side modal dismissal as scripts/editor-metrics-dump.mjs. */
async function dismissEditorModals(url, version) {
  await api(url, '/settings/user', { method: 'POST', body: { telemetryEnabled: false } });
  await api(url, '/settings/user', {
    method: 'POST',
    body: {
      editor: { view: { 'view-show-welcome-tours': false }, tours: { welcome: version } },
    },
  });
}

/** Accepts a flows array (Admin API v1) or a `{flows: [...]}` envelope (v2). */
function flowsArray(doc, sourcePath) {
  if (Array.isArray(doc)) return doc;
  if (doc !== null && typeof doc === 'object' && Array.isArray(doc.flows)) return doc.flows;
  throw new Error(`${sourcePath}: expected a flows.json array or a {flows: [...]} envelope.`);
}

function loadMetricsFixtures() {
  let files;
  try {
    files = readdirSync(METRICS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(join(METRICS_DIR, f), 'utf8')));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const flows = flowsArray(JSON.parse(readFileSync(opts.flow, 'utf8')), opts.flow);
  const tabs = flows.filter((n) => n.type === 'tab');
  const tabId = opts.tab ?? tabs[0]?.id;
  if (tabId === undefined) throw new Error(`${opts.flow} contains no tab.`);

  const settings = await api(opts.url, '/settings');
  const version = settings.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Could not read Node-RED version from /settings');
  }
  console.log(`Node-RED ${version} at ${opts.url}; flow ${opts.flow} tab ${tabId}`);

  // Fixture-freshness guard: never compare against an uncalibrated editor.
  const freshness = checkFixtureFreshness({
    liveVersion: version,
    fixtures: loadMetricsFixtures(),
  });
  if (!freshness.fresh) {
    console.error(`Fixture-freshness guard FAILED (${freshness.rule}): ${freshness.reason}`);
    process.exit(EXIT_ABORT);
  }
  console.log(`Fixture freshness: ${freshness.rule} — ${freshness.reason}`);

  await dismissEditorModals(opts.url, version);

  const priorFlows = await api(opts.url, '/flows');
  await api(opts.url, '/flows', {
    method: 'POST',
    body: flows,
    headers: { 'Node-RED-Deployment-Type': 'full' },
  });
  console.log(`Fixture deployed (${flows.length} objects).`);

  let captured;
  const chrome = await launchChrome({ chromePath: opts.chrome });
  try {
    const session = await connect({ port: chrome.port });
    await session.navigate(`${opts.url}/`);
    captured = await captureEditorGeometry(session, { tabId });
    if (opts.screenshot) {
      await session.screenshot({ path: opts.screenshot, fullPage: true });
      console.log(`Screenshot: ${opts.screenshot}`);
    }
    await session.close();
  } finally {
    await chrome.kill();
    if (!opts.keepFlows) {
      await api(opts.url, '/flows', {
        method: 'POST',
        body: priorFlows,
        headers: { 'Node-RED-Deployment-Type': 'full' },
      });
      console.log('Prior flows restored.');
    }
  }

  if (captured.nodeRedVersion !== version) {
    throw new Error(
      `Version mismatch: /settings says ${version}, editor says ${captured.nodeRedVersion}`,
    );
  }
  if (captured.activeWorkspace !== tabId) {
    throw new Error(
      `Editor active workspace is ${captured.activeWorkspace}, expected ${tabId} — capture aborted.`,
    );
  }

  const expectedAll = renderGeometry(flows, tabId);
  if (expectedAll.length === 0) throw new Error(`renderGeometry produced no entries for ${tabId}.`);

  // Default basis: per-node geometry + ports (fix-plan REND-7). Group rects
  // are editor-DERIVED (recomputed from members + label padding on load,
  // stored x/y/w/h ignored) — see EDITOR_DERIVED_KINDS in eval/fidelity.mjs
  // and docs/EVALUATION.md. --include-groups compares them anyway.
  const expected = opts.includeGroups ? expectedAll : editorComparableEntries(expectedAll);
  const actual = opts.includeGroups ? captured.entries : editorComparableEntries(captured.entries);
  if (!opts.includeGroups && expectedAll.length !== expected.length) {
    console.log(
      `Groups excluded from the basis (${expectedAll.length - expected.length} entries — ` +
        'editor derives group rects; --include-groups to inspect them).',
    );
  }

  const result = compareGeometry(expected, actual, { tolerancePx: opts.tolerance });
  console.log(formatFidelityReport(result));

  if (opts.json) {
    writeFileSync(
      opts.json,
      JSON.stringify(
        {
          nodeRedVersion: version,
          flow: opts.flow,
          tabId,
          freshness: { rule: freshness.rule, fixture: freshness.matched?.nodeRedVersion ?? null },
          result,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`Result JSON: ${opts.json}`);
  }
  process.exit(result.pass ? EXIT_OK : EXIT_FIDELITY_FAIL);
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(EXIT_ABORT);
});
