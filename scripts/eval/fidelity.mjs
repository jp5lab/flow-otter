/**
 * REND-7 — renderer-fidelity comparator + live-editor geometry capture.
 *
 * The SINGLE ±2px comparator (fix-plan amendment: per-corner + per-port —
 * the stricter basis) shared by `npm run fidelity:editor`
 * (scripts/editor-fidelity-check.mjs) and EVAL-2's `eval:s5` fidelity leg.
 * EVAL-2 must consume THIS module — duplicate comparators are banned by the
 * plan (gates minor + safety major).
 *
 * Expected side: `renderGeometry(flows, tabId)` entries (frozen contract #1,
 * src/toolkit/render/svg.ts) — `{id, kind, x, y, w, h, ports[]}`,
 * center-convention, post-translate.
 *
 * Actual side: the live Node-RED editor, captured over CDP
 * (scripts/eval/cdp.mjs — the shared zero-new-dependency browser stack) and
 * normalized into the same entry shape by `normalizeEditorDump`:
 *   - regular nodes: editor model x/y (centers) + w/h; port-box centers from
 *     the DOM port-group translates (+5 = half of PORT_BOX_SIZE_PX).
 *   - comments: model centers, no ports.
 *   - groups: model top-left bbox converted to center-convention.
 *   - junctions: model centers, w=h=10, input AND output port at the center
 *     (renderGeometry's junction contract). Junction <g> elements carry no
 *     id attribute in the editor DOM, so the comparator pairs junction
 *     entries BY COORDINATES (REND-1 finding), never by id.
 *
 * Pure data-in/data-out except `captureEditorGeometry` (takes a connected
 * CdpSession). No main — importing this module has no side effects.
 */

/** Comparison tolerance (fix-plan REND-7: single ±2px comparator). */
export const FIDELITY_TOLERANCE_PX = 2;

/**
 * Pairing radius for junctions (paired by coordinates, not id). Generous —
 * half the 20px width grid — so a slightly-drifted junction still pairs and
 * is reported as a corner mismatch instead of missing+unexpected noise.
 */
export const JUNCTION_PAIR_RADIUS_PX = 20;

/** Half of PORT_BOX_SIZE_PX (10) — DOM port translates are box top-left. */
const PORT_BOX_HALF_PX = 5;

/** Float-noise epsilon on top of the tolerance. */
const EPS = 1e-9;

/**
 * Kinds whose geometry the EDITOR derives instead of honoring flows.json —
 * excluded from the live-editor comparison basis (fix-plan REND-7 names
 * "per-node geometry + ports").
 *
 * Groups: verified live on 4.1.11 (2026-06-10) — the editor recomputes
 * every group rect from its member bboxes + label padding on load and
 * IGNORES the stored x/y/w/h (a group with no stored geometry renders
 * fine; e1's FlowOtter-autofit boxes diverge up to 46px). Stored group
 * geometry is autofit output, not editor ground truth, so a live group
 * comparison would compare two autofit algorithms — not renderer fidelity.
 * Group-rendering correctness stays covered in CI by REND-3's containment
 * assertion (svg.test.ts (d)) and REND-2's group-autofit pins; closing the
 * autofit-vs-editor padding gap belongs to the group-geometry owner (D-1).
 */
export const EDITOR_DERIVED_KINDS = Object.freeze(['group']);

/**
 * Filter a geometry-entry array down to the live-editor comparison basis
 * (drops `EDITOR_DERIVED_KINDS`). Apply to BOTH sides before
 * `compareGeometry` — shared by fidelity:editor and eval:s5.
 */
export function editorComparableEntries(entries) {
  return entries.filter((e) => !EDITOR_DERIVED_KINDS.includes(e.kind));
}

/** The four corners of a center-convention entry. */
export function cornersOf(entry) {
  const left = entry.x - entry.w / 2;
  const top = entry.y - entry.h / 2;
  return [
    { corner: 'top-left', x: left, y: top },
    { corner: 'top-right', x: left + entry.w, y: top },
    { corner: 'bottom-left', x: left, y: top + entry.h },
    { corner: 'bottom-right', x: left + entry.w, y: top + entry.h },
  ];
}

function isJunctionEntry(e) {
  return e.kind === 'junction';
}

function entryRef(e) {
  return { id: e.id, kind: e.kind, x: e.x, y: e.y };
}

/**
 * Pair expected entries to actual entries. Non-junction kinds pair by id;
 * junctions pair by nearest center within `junctionPairRadiusPx` (greedy,
 * deterministic: expected junctions sorted by (x, y, id)). `offset` is added
 * to ACTUAL coordinates first (maps editor coordinates into renderer space
 * when renderGeometry's negative-extent translate fired; zero for the
 * canonical e1 fixture).
 */
export function pairEntries(
  expected,
  actual,
  { junctionPairRadiusPx = JUNCTION_PAIR_RADIUS_PX, offset = { x: 0, y: 0 } } = {},
) {
  const pairs = [];
  const missing = [];
  const unexpected = [];

  const actualById = new Map();
  const actualJunctions = [];
  for (const a of actual) {
    if (isJunctionEntry(a)) actualJunctions.push(a);
    else actualById.set(a.id, a);
  }

  const consumed = new Set();
  const expectedJunctions = [];
  for (const e of expected) {
    if (isJunctionEntry(e)) {
      expectedJunctions.push(e);
      continue;
    }
    const a = actualById.get(e.id);
    if (a === undefined) {
      missing.push(entryRef(e));
    } else {
      consumed.add(a);
      pairs.push({ expected: e, actual: a });
    }
  }

  // Junctions: greedy nearest-center pairing in deterministic order.
  expectedJunctions.sort((p, q) => p.x - q.x || p.y - q.y || (p.id < q.id ? -1 : 1));
  const pool = [...actualJunctions];
  for (const e of expectedJunctions) {
    let best = null;
    let bestDist = Infinity;
    for (const a of pool) {
      const dx = a.x + offset.x - e.x;
      const dy = a.y + offset.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        best = a;
        bestDist = dist;
      }
    }
    if (best !== null && bestDist <= junctionPairRadiusPx) {
      pool.splice(pool.indexOf(best), 1);
      consumed.add(best);
      pairs.push({ expected: e, actual: best });
    } else {
      missing.push(entryRef(e));
    }
  }

  for (const a of actual) {
    if (!consumed.has(a)) unexpected.push(entryRef(a));
  }
  return { pairs, missing, unexpected };
}

function pushDelta(mismatches, entry, check, exp, act, offset, tolerancePx) {
  const dx = act.x + offset.x - exp.x;
  const dy = act.y + offset.y - exp.y;
  const ok = Math.abs(dx) <= tolerancePx + EPS && Math.abs(dy) <= tolerancePx + EPS;
  if (!ok) {
    mismatches.push({
      id: entry.id,
      kind: entry.kind,
      check,
      expected: { x: exp.x, y: exp.y },
      actual: { x: act.x + offset.x, y: act.y + offset.y },
      dx,
      dy,
    });
  }
  return ok;
}

/**
 * THE comparator (fix-plan REND-7, single source): per-corner + per-port,
 * |Δx| ≤ tolerance AND |Δy| ≤ tolerance (±2px default, inclusive) for every
 * one of the 4 corners of every paired entry and every port-box center.
 * Port identity is (kind, index); count drift is its own mismatch. Result is
 * snake_case (the repo wire convention).
 */
export function compareGeometry(expected, actual, opts = {}) {
  const {
    tolerancePx = FIDELITY_TOLERANCE_PX,
    junctionPairRadiusPx = JUNCTION_PAIR_RADIUS_PX,
    offset = { x: 0, y: 0 },
  } = opts;
  const { pairs, missing, unexpected } = pairEntries(expected, actual, {
    junctionPairRadiusPx,
    offset,
  });

  const mismatches = [];
  let cornersChecked = 0;
  let portsChecked = 0;

  for (const { expected: e, actual: a } of pairs) {
    const expCorners = cornersOf(e);
    const actCorners = cornersOf(a);
    for (let i = 0; i < expCorners.length; i++) {
      cornersChecked++;
      pushDelta(
        mismatches,
        e,
        `corner:${expCorners[i].corner}`,
        expCorners[i],
        actCorners[i],
        offset,
        tolerancePx,
      );
    }

    for (const kind of ['input', 'output']) {
      const expPorts = e.ports.filter((p) => p.kind === kind);
      const actPorts = a.ports.filter((p) => p.kind === kind);
      if (expPorts.length !== actPorts.length) {
        mismatches.push({
          id: e.id,
          kind: e.kind,
          check: `port-count:${kind}`,
          expected: { count: expPorts.length },
          actual: { count: actPorts.length },
          dx: null,
          dy: null,
        });
      }
      const actByIndex = new Map(actPorts.map((p) => [p.index, p]));
      for (const p of expPorts) {
        const q = actByIndex.get(p.index);
        if (q === undefined) continue; // covered by port-count above
        portsChecked++;
        pushDelta(mismatches, e, `port:${kind}[${p.index}]`, p, q, offset, tolerancePx);
      }
    }
  }

  return {
    pass: mismatches.length === 0 && missing.length === 0 && unexpected.length === 0,
    tolerance_px: tolerancePx,
    entries_compared: pairs.length,
    corners_checked: cornersChecked,
    ports_checked: portsChecked,
    mismatches,
    missing,
    unexpected,
  };
}

const REPORT_LINE_CAP = 50;

/** Human-readable report for a `compareGeometry` result. */
export function formatFidelityReport(result) {
  const lines = [
    `fidelity: ${result.pass ? 'PASS' : 'FAIL'} — ` +
      `${result.entries_compared} entries, ${result.corners_checked} corners, ` +
      `${result.ports_checked} ports checked (tolerance ±${result.tolerance_px}px)`,
  ];
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  const detail = [];
  for (const m of result.mismatches) {
    if (m.dx === null) {
      detail.push(
        `  MISMATCH ${m.kind} ${m.id} ${m.check}: expected ${m.expected.count} got ${m.actual.count}`,
      );
    } else {
      detail.push(
        `  MISMATCH ${m.kind} ${m.id} ${m.check}: ` +
          `expected (${fmt(m.expected.x)}, ${fmt(m.expected.y)}) ` +
          `got (${fmt(m.actual.x)}, ${fmt(m.actual.y)}) ` +
          `delta (${fmt(m.dx)}, ${fmt(m.dy)})`,
      );
    }
  }
  for (const e of result.missing) {
    detail.push(`  MISSING ${e.kind} ${e.id} at (${fmt(e.x)}, ${fmt(e.y)}) — not in the editor`);
  }
  for (const e of result.unexpected) {
    detail.push(`  UNEXPECTED ${e.kind} ${e.id} at (${fmt(e.x)}, ${fmt(e.y)}) — editor-only entry`);
  }
  if (detail.length > REPORT_LINE_CAP) {
    lines.push(...detail.slice(0, REPORT_LINE_CAP));
    lines.push(`  … and ${detail.length - REPORT_LINE_CAP} more`);
  } else {
    lines.push(...detail);
  }
  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────
 * In-page functions. Serialized via Function.prototype.toString and shipped
 * over CDP — keep them self-contained browser-only code (no imports, no
 * Node globals, no references to module scope).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Readiness probe, ACTIVE-workspace scoped (nodes on non-active tabs may
 * never get dimensions — REND-1 finding): every model node on the active
 * workspace has rendered numeric w > 0.
 */
export function pageEditorReady() {
  if (!window.RED || !RED.nodes || !RED.workspaces || !RED.settings || !RED.settings.version) {
    return false;
  }
  if (!document.querySelector('#red-ui-workspace-chart svg g.red-ui-flow-node')) return false;
  const active = RED.workspaces.active();
  if (!active) return false;
  let total = 0;
  let withDims = 0;
  RED.nodes.eachNode((n) => {
    if (n.z !== active) return;
    total++;
    if (typeof n.w === 'number' && n.w > 0) withDims++;
  });
  return total > 0 && total === withDims;
}

/**
 * Raw geometry dump of the ACTIVE workspace: editor model x/y/w/h per
 * rendered node (centers; comments included as nodes), DOM port-group
 * translates per node, group model bboxes (top-left), junction model
 * waypoints. Config nodes never appear (they are not on the canvas).
 */
export function pageGeometryDump() {
  const SVG = '#red-ui-workspace-chart svg ';
  const parseTranslate = (el) => {
    const t = el && el.getAttribute('transform');
    const m = t && t.match(/translate\(\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  const byId = (p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
  const active = RED.workspaces.active();
  const model = {};
  RED.nodes.eachNode((n) => {
    model[n.id] = n;
  });

  const nodes = [];
  document.querySelectorAll(SVG + 'g.red-ui-flow-node[id]').forEach((g) => {
    const id = g.getAttribute('id');
    const n = model[id];
    if (!n || n.z !== active) return;
    nodes.push({
      id,
      type: n.type,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      inputPorts: Array.from(g.querySelectorAll('g.red-ui-flow-port-input')).map(parseTranslate),
      outputPorts: Array.from(g.querySelectorAll('g.red-ui-flow-port-output')).map(parseTranslate),
    });
  });
  nodes.sort(byId);

  const groups = [];
  RED.nodes.eachGroup((grp) => {
    if (grp.z !== active) return;
    groups.push({ id: grp.id, x: grp.x, y: grp.y, w: grp.w, h: grp.h });
  });
  groups.sort(byId);

  const junctions = [];
  RED.nodes.eachJunction((j) => {
    if (j.z !== active) return;
    junctions.push({
      id: j.id,
      x: j.x,
      y: j.y,
      w: typeof j.w === 'number' ? j.w : null,
      h: typeof j.h === 'number' ? j.h : null,
    });
  });
  junctions.sort(byId);

  return {
    version: RED.settings.version,
    activeWorkspace: active,
    nodes,
    groups,
    junctions,
  };
}

/**
 * Normalize a `pageGeometryDump` result into renderGeometry-shaped entries
 * (`{id, kind, x, y, w, h, ports[]}`, center-convention). Pure — unit-tested
 * against synthetic dumps.
 */
export function normalizeEditorDump(raw) {
  const entries = [];
  for (const n of raw.nodes) {
    if (n.type === 'comment') {
      entries.push({ id: n.id, kind: 'comment', x: n.x, y: n.y, w: n.w, h: n.h, ports: [] });
      continue;
    }
    const left = n.x - n.w / 2;
    const top = n.y - n.h / 2;
    const ports = [];
    (n.inputPorts ?? []).forEach((t, i) => {
      if (t === null) return;
      ports.push({
        kind: 'input',
        index: i,
        x: left + t.x + PORT_BOX_HALF_PX,
        y: top + t.y + PORT_BOX_HALF_PX,
      });
    });
    (n.outputPorts ?? []).forEach((t, i) => {
      if (t === null) return;
      ports.push({
        kind: 'output',
        index: i,
        x: left + t.x + PORT_BOX_HALF_PX,
        y: top + t.y + PORT_BOX_HALF_PX,
      });
    });
    entries.push({ id: n.id, kind: 'node', x: n.x, y: n.y, w: n.w, h: n.h, ports });
  }
  for (const g of raw.groups) {
    entries.push({
      id: g.id,
      kind: 'group',
      x: g.x + g.w / 2,
      y: g.y + g.h / 2,
      w: g.w,
      h: g.h,
      ports: [],
    });
  }
  for (const j of raw.junctions) {
    const w = typeof j.w === 'number' && j.w > 0 ? j.w : 10;
    const h = typeof j.h === 'number' && j.h > 0 ? j.h : 10;
    entries.push({
      id: j.id,
      kind: 'junction',
      x: j.x,
      y: j.y,
      w,
      h,
      // renderGeometry's junction contract: input AND output port at the
      // waypoint center (wires attach center-on).
      ports: [
        { kind: 'input', index: 0, x: j.x, y: j.y },
        { kind: 'output', index: 0, x: j.x, y: j.y },
      ],
    });
  }
  return entries;
}

/**
 * Capture normalized editor geometry from a connected CdpSession (the page
 * must already be navigated to the editor). Optionally switches to `tabId`
 * first, then waits for active-workspace readiness.
 */
export async function captureEditorGeometry(
  session,
  { tabId, timeoutMs = 60_000, pollMs = 400 } = {},
) {
  await session.waitFor(
    "!!(window.RED && RED.nodes && RED.workspaces && document.querySelector('#red-ui-workspace-chart svg'))",
    { timeoutMs, pollMs },
  );
  if (tabId !== undefined) {
    await session.evaluate(`RED.workspaces.show(${JSON.stringify(tabId)})`);
  }
  await session.waitFor(`(${pageEditorReady.toString()})()`, { timeoutMs, pollMs });
  const raw = await session.dump(`(${pageGeometryDump.toString()})()`);
  return {
    nodeRedVersion: raw.version,
    activeWorkspace: raw.activeWorkspace,
    entries: normalizeEditorDump(raw),
    raw,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Fixture-freshness guard.
 * ────────────────────────────────────────────────────────────────────────── */

function parseVersion(v) {
  const m = typeof v === 'string' && v.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

function validCapturedAt(fixture) {
  const t = Date.parse(fixture.capturedAt ?? '');
  return Number.isFinite(t) && t <= Date.now();
}

/**
 * Are the committed editor-metrics fixtures fresh for the LIVE editor
 * version? Match rules, first hit wins:
 *   1. `exact`                  — a fixture's nodeRedVersion equals liveVersion.
 *   2. `patch-drift`            — same major.minor (dimension changes ride
 *                                  minors; the appearance rework shipped in 5.0).
 *   3. `nodered-4.0-assumption` — live 4.0.x with a 4.1.x fixture (recorded
 *                                  assumption in each fixture + EVALUATION.md).
 * Anything else is `stale` → re-run scripts/editor-metrics-dump.mjs. A
 * matched fixture with an unparseable/future capturedAt is `invalid-fixture`.
 */
export function checkFixtureFreshness({ liveVersion, fixtures }) {
  const live = parseVersion(liveVersion);
  if (live === null) {
    return {
      fresh: false,
      rule: 'invalid-live-version',
      matched: null,
      reason: `Live Node-RED version ${JSON.stringify(liveVersion)} is not semver.`,
    };
  }
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return {
      fresh: false,
      rule: 'no-fixtures',
      matched: null,
      reason:
        'No editor-metrics fixtures found — run `node scripts/editor-metrics-dump.mjs` and commit the capture.',
    };
  }

  const candidates = fixtures
    .map((f) => ({ fixture: f, version: parseVersion(f.nodeRedVersion) }))
    .filter((c) => c.version !== null);

  const finish = (rule, matched, reason) => {
    if (!validCapturedAt(matched)) {
      return {
        fresh: false,
        rule: 'invalid-fixture',
        matched,
        reason: `Fixture for ${matched.nodeRedVersion} has an unparseable or future capturedAt (${String(matched.capturedAt)}).`,
      };
    }
    return { fresh: true, rule, matched, reason };
  };

  const exact = candidates.find((c) => c.fixture.nodeRedVersion === liveVersion);
  if (exact) {
    return finish(
      'exact',
      exact.fixture,
      `Fixture ${liveVersion} matches the live editor exactly.`,
    );
  }
  const sameMinor = candidates.find(
    (c) => c.version.major === live.major && c.version.minor === live.minor,
  );
  if (sameMinor) {
    return finish(
      'patch-drift',
      sameMinor.fixture,
      `Live ${liveVersion} differs from fixture ${sameMinor.fixture.nodeRedVersion} only in patch — dimensions assumed identical within a minor.`,
    );
  }
  if (live.major === 4 && live.minor === 0) {
    const fortyOne = candidates.find((c) => c.version.major === 4 && c.version.minor === 1);
    if (fortyOne) {
      return finish(
        'nodered-4.0-assumption',
        fortyOne.fixture,
        `Live ${liveVersion} covered by the recorded 4.0.x-equals-4.1 assumption (fixture ${fortyOne.fixture.nodeRedVersion}).`,
      );
    }
  }
  return {
    fresh: false,
    rule: 'stale',
    matched: null,
    reason:
      `No committed editor-metrics fixture covers live Node-RED ${liveVersion} ` +
      `(have: ${candidates.map((c) => c.fixture.nodeRedVersion).join(', ') || 'none parseable'}). ` +
      'Re-run `node scripts/editor-metrics-dump.mjs` against this runtime and commit the capture ' +
      '(docs/EVALUATION.md "Editor ground-truth metrics").',
  };
}
