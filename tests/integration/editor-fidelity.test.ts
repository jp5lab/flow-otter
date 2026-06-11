/**
 * REND-7 layer B — LIVE editor-fidelity check (R3 acceptance, audit F9).
 *
 * Env-gated behind FLOWOTTER_LIVE_EDITOR=true so the standard integration
 * suite stays green on machines without Chrome (everything here is skipped
 * unless explicitly opted in):
 *
 *   FLOWOTTER_LIVE_EDITOR=true KEEP_STACK=true \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/editor-fidelity.test.ts
 *
 * Imports the canonical e1 audit fixture into the sterile stack, opens the
 * real Node-RED editor in headless Chrome over CDP (scripts/eval/cdp.mjs),
 * captures per-node geometry + port-box centers, and compares against
 * `renderGeometry` (frozen contract #1) with the single ±2px comparator
 * (scripts/eval/fidelity.mjs — shared with `npm run fidelity:editor` and
 * EVAL-2's eval:s5 leg). Layer A (always-on CI) is the REND-3 assertion
 * suite + re-bless protocol in tests/unit/toolkit/render/svg.test.ts and the
 * REND-2 editor-truth pins. Prior flows are restored afterwards.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connect,
  launchChrome,
  type CdpSession,
  type LaunchedChrome,
} from '../../scripts/eval/cdp.mjs';
import {
  captureEditorGeometry,
  checkFixtureFreshness,
  compareGeometry,
  editorComparableEntries,
  formatFidelityReport,
  type FixtureFreshnessFixture,
} from '../../scripts/eval/fidelity.mjs';
import { renderGeometry } from '../../src/toolkit/render/svg.js';
import type { FlowsJson } from '../../src/shared/flows-json.js';

const LIVE = process.env['FLOWOTTER_LIVE_EDITOR'] === 'true';
const NR_BASE = process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E1_PATH = path.resolve(HERE, '../fixtures/audit-2026-06-10/e1-flows.json');
const METRICS_DIR = path.resolve(HERE, '../fixtures/editor-metrics');
const E1_TAB = 'f6f2187d.f17ca8';

async function api(
  pathName: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const req: RequestInit = {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  };
  if (init.body !== undefined) req.body = JSON.stringify(init.body);
  const res = await fetch(NR_BASE + pathName, req);
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathName} -> HTTP ${res.status}`);
  }
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as unknown) : null;
}

describe.runIf(LIVE)('editor fidelity — live (FLOWOTTER_LIVE_EDITOR=true)', () => {
  const e1Doc = JSON.parse(readFileSync(E1_PATH, 'utf8')) as { flows: FlowsJson };
  let liveVersion: string;
  let priorFlows: unknown;
  let chrome: LaunchedChrome | undefined;
  let session: CdpSession | undefined;

  beforeAll(async () => {
    const settings = (await api('/settings')) as { version: string };
    liveVersion = settings.version;

    // Server-side modal dismissal (telemetry + welcome tour) — the compose
    // stack's /data is ephemeral, so a fresh container always needs this.
    await api('/settings/user', { method: 'POST', body: { telemetryEnabled: false } });
    await api('/settings/user', {
      method: 'POST',
      body: {
        editor: { view: { 'view-show-welcome-tours': false }, tours: { welcome: liveVersion } },
      },
    });

    priorFlows = await api('/flows');
    await api('/flows', {
      method: 'POST',
      body: e1Doc.flows,
      headers: { 'Node-RED-Deployment-Type': 'full' },
    });

    chrome = await launchChrome({});
    session = await connect({ port: chrome.port });
    await session.navigate(`${NR_BASE}/`);
  }, 120_000);

  afterAll(async () => {
    await session?.close();
    await chrome?.kill();
    if (priorFlows !== undefined) {
      await api('/flows', {
        method: 'POST',
        body: priorFlows,
        headers: { 'Node-RED-Deployment-Type': 'full' },
      });
    }
  }, 60_000);

  it('fixture-freshness guard: the live editor version is covered by a committed capture', () => {
    const fixtures = readdirSync(METRICS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map(
        (f) =>
          JSON.parse(readFileSync(path.join(METRICS_DIR, f), 'utf8')) as FixtureFreshnessFixture,
      );
    const freshness = checkFixtureFreshness({ liveVersion, fixtures });
    expect(freshness.reason).toBeTruthy();
    expect(freshness.fresh, freshness.reason).toBe(true);
  });

  it('R3 acceptance rehearsal: live editor geometry matches renderGeometry within ±2px', async () => {
    const captured = await captureEditorGeometry(session!, { tabId: E1_TAB });
    expect(captured.nodeRedVersion).toBe(liveVersion);
    expect(captured.activeWorkspace).toBe(E1_TAB);

    const expectedAll = renderGeometry(e1Doc.flows, E1_TAB);
    expect(expectedAll).toHaveLength(26); // 14 nodes + 6 groups + 6 comments

    // Basis: per-node geometry + ports (fix-plan REND-7). Group rects are
    // editor-DERIVED (recomputed from members + label padding, stored
    // x/y/w/h ignored — verified live 2026-06-10, deltas up to 46px on
    // e1's autofit boxes), so they are not renderer-fidelity ground truth;
    // see EDITOR_DERIVED_KINDS and docs/EVALUATION.md.
    const expected = editorComparableEntries(expectedAll);
    const actual = editorComparableEntries(captured.entries);
    expect(expected).toHaveLength(20); // 14 nodes + 6 comments

    const result = compareGeometry(expected, actual);
    expect(result.entries_compared).toBe(20);
    expect(result.ports_checked).toBe(22);
    expect(result.pass, formatFidelityReport(result)).toBe(true);
  }, 120_000);
});
