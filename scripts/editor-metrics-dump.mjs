#!/usr/bin/env node
/**
 * REND-1 — editor ground-truth metrics capture (resolves DESIGN.md open
 * question 3).
 *
 * Deploys the calibration flow (tests/fixtures/render/calibration-flow.json)
 * to a LOCAL Node-RED instance, opens the editor in headless Chrome over CDP
 * (scripts/eval/cdp.mjs — the shared zero-new-dependency browser stack), and
 * dumps the editor's OWN geometry model plus the rendered DOM:
 *
 *   - RED.nodes model geometry per node: {type, name, x, y, w, h, outputs, inputs}
 *   - junction / comment / group DOM bboxes
 *   - label getComputedStyle (font family/size/weight/style)
 *   - per-port-count output-port offsets (port count 1/2/3/4 via the
 *     calibration switches + 3-output function)
 *
 * The result is written to tests/fixtures/editor-metrics/nodered-<version>.json
 * — a one-time, committed fixture. CI NEVER runs this script; it re-runs only
 * on a Node-RED minor bump (see docs/EVALUATION.md "Editor ground-truth
 * metrics" for the full recipe including the 5.0 compose-override leg).
 *
 * Versioning assumption (recorded in the fixture): Node-RED 4.0.x is assumed
 * dimension-identical to 4.1.x — the node-appearance rework shipped in 5.0.
 * Run an optional 4.0 leg if a container is handy.
 *
 * Usage:
 *   node scripts/editor-metrics-dump.mjs [--url http://localhost:1880]
 *       [--flow tests/fixtures/render/calibration-flow.json]
 *       [--out-dir tests/fixtures/editor-metrics]
 *       [--chrome "<path to chrome binary>"]
 *       [--screenshot /tmp/editor.png] [--keep-flows]
 *
 * Talks to localhost only. Restores the previously-deployed flows when done
 * (unless --keep-flows).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { connect, launchChrome } from './eval/cdp.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {
    url: 'http://localhost:1880',
    flow: join(REPO_ROOT, 'tests', 'fixtures', 'render', 'calibration-flow.json'),
    outDir: join(REPO_ROOT, 'tests', 'fixtures', 'editor-metrics'),
    chrome: undefined,
    screenshot: undefined,
    keepFlows: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') opts.url = argv[++i];
    else if (a === '--flow') opts.flow = resolve(argv[++i]);
    else if (a === '--out-dir') opts.outDir = resolve(argv[++i]);
    else if (a === '--chrome') opts.chrome = argv[++i];
    else if (a === '--screenshot') opts.screenshot = resolve(argv[++i]);
    else if (a === '--keep-flows') opts.keepFlows = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(opts.url)) {
    throw new Error(`--url must be a local Node-RED instance, got: ${opts.url}`);
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

/**
 * Dismiss the telemetry prompt and the welcome tour server-side so the
 * editor opens clean (the sterile compose stack loses these on re-up —
 * /data is ephemeral). Idempotent; required for the 5.0 leg, harmless on 4.1.
 */
async function dismissEditorModals(url, version) {
  await api(url, '/settings/user', { method: 'POST', body: { telemetryEnabled: false } });
  await api(url, '/settings/user', {
    method: 'POST',
    body: {
      editor: { view: { 'view-show-welcome-tours': false }, tours: { welcome: version } },
    },
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * In-page dump function. Runs inside the Node-RED editor; serialized via
 * Function.prototype.toString and shipped over CDP — keep it self-contained
 * browser-only code (no imports, no Node globals).
 * ────────────────────────────────────────────────────────────────────────── */
function pageDump() {
  const SVG = '#red-ui-workspace-chart svg ';
  const parseTranslate = (el) => {
    const t = el && el.getAttribute('transform');
    const m = t && t.match(/translate\(\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  const bboxOf = (el) => {
    if (!el) return null;
    try {
      const b = el.getBBox();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    } catch {
      return null;
    }
  };
  const rectAttrs = (r) =>
    r
      ? {
          x: r.hasAttribute('x') ? Number(r.getAttribute('x')) : 0,
          y: r.hasAttribute('y') ? Number(r.getAttribute('y')) : 0,
          width: Number(r.getAttribute('width')),
          height: Number(r.getAttribute('height')),
        }
      : null;

  const result = {
    version: RED.settings.version,
    userAgent: navigator.userAgent,
    activeWorkspace: RED.workspaces.active(),
    nodes: [],
    junctions: [],
    groups: [],
    labelStyle: null,
  };

  const model = {};
  RED.nodes.eachNode((n) => {
    model[n.id] = n;
  });

  document.querySelectorAll(SVG + 'g.red-ui-flow-node[id]').forEach((g) => {
    const id = g.getAttribute('id');
    const n = model[id];
    if (!n) return;
    const labelG = g.querySelector('g.red-ui-flow-node-label');
    const iconBBox = bboxOf(g.querySelector('g.red-ui-flow-node-icon-group'));
    result.nodes.push({
      id,
      type: n.type,
      name: n.name || '',
      model: {
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
        inputs: typeof n.inputs === 'number' ? n.inputs : null,
        outputs: typeof n.outputs === 'number' ? n.outputs : null,
      },
      dom: {
        translate: parseTranslate(g),
        body: rectAttrs(g.querySelector('rect.red-ui-flow-node')),
        bbox: bboxOf(g),
        label: labelG ? { translate: parseTranslate(labelG), bbox: bboxOf(labelG) } : null,
        icon:
          iconBBox && iconBBox.width > 0
            ? { width: iconBBox.width, height: iconBBox.height }
            : null,
        hasButton: g.querySelector('g.red-ui-flow-node-button') !== null,
        inputPorts: Array.from(g.querySelectorAll('g.red-ui-flow-port-input')).map(parseTranslate),
        outputPorts: Array.from(g.querySelectorAll('g.red-ui-flow-port-output')).map(
          parseTranslate,
        ),
      },
    });
  });
  result.nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Junction <g> elements carry no id attribute — pair DOM to model by the
  // (x, y) translate, which equals the junction's model coordinates.
  const junctionDom = Array.from(document.querySelectorAll(SVG + 'g.red-ui-flow-junction')).map(
    (g) => ({
      translate: parseTranslate(g),
      bbox: bboxOf(g),
      background: rectAttrs(g.querySelector('rect.red-ui-flow-junction-background')),
    }),
  );
  RED.nodes.eachJunction((j) => {
    const dom =
      junctionDom.find(
        (d) =>
          d.translate && Math.abs(d.translate.x - j.x) < 1 && Math.abs(d.translate.y - j.y) < 1,
      ) ?? null;
    result.junctions.push({
      id: j.id,
      model: {
        x: j.x,
        y: j.y,
        w: typeof j.w === 'number' ? j.w : null,
        h: typeof j.h === 'number' ? j.h : null,
      },
      dom,
    });
  });
  result.junctions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  RED.nodes.eachGroup((grp) => {
    const g = document.querySelector(SVG + 'g.red-ui-flow-group[id="' + grp.id + '"]');
    result.groups.push({
      id: grp.id,
      name: grp.name || '',
      model: { x: grp.x, y: grp.y, w: grp.w, h: grp.h },
      members: (grp.nodes || []).map((m) => (typeof m === 'string' ? m : m.id)),
      dom: g
        ? {
            translate: parseTranslate(g),
            body: rectAttrs(g.querySelector('rect.red-ui-flow-group-body')),
            outline: rectAttrs(g.querySelector('rect.red-ui-flow-group-outline')),
            bbox: bboxOf(g),
          }
        : null,
    });
  });
  result.groups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const labelEl = document.querySelector(
    SVG + 'g.red-ui-flow-node[id="calib-lad-20"] g.red-ui-flow-node-label',
  );
  if (labelEl) {
    const cs = getComputedStyle(labelEl);
    result.labelStyle = {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
    };
  }

  return result;
}

/** In-page readiness probe: every model node has rendered dimensions. */
function pageReady() {
  if (!window.RED || !RED.nodes || !RED.settings || !RED.settings.version) return false;
  if (!document.querySelector('#red-ui-workspace-chart svg g.red-ui-flow-node')) return false;
  let total = 0;
  let withDims = 0;
  RED.nodes.eachNode((n) => {
    total++;
    if (typeof n.w === 'number' && n.w > 0) withDims++;
  });
  return total > 0 && total === withDims;
}

/**
 * Per-port-count output-port offsets, derived from the captured nodes.
 * Offsets are recorded relative to the node box: `yTop` from the node's top
 * edge, `xFromRight` from the right edge (ports overhang by half their
 * 10px width). Consistency across same-count nodes is asserted here so the
 * fixture never commits an ambiguous table.
 */
function derivePortOffsets(nodes) {
  const byCount = {};
  for (const n of nodes) {
    const count = n.dom.outputPorts.length;
    if (count === 0 || n.dom.body === null) continue;
    if (count !== n.model.outputs) continue; // collapsed/abnormal — skip
    const entry = {
      h: n.model.h,
      xFromRight: n.dom.body.width - n.dom.outputPorts[0].x,
      ys: n.dom.outputPorts.map((p) => p.y),
    };
    const key = String(count);
    const prior = byCount[key];
    if (prior === undefined) {
      byCount[key] = { ...entry, sourceNodeIds: [n.id] };
    } else {
      const same =
        prior.h === entry.h &&
        prior.xFromRight === entry.xFromRight &&
        JSON.stringify(prior.ys) === JSON.stringify(entry.ys);
      if (!same) {
        throw new Error(
          `Inconsistent output-port offsets for count=${key}: ` +
            `${JSON.stringify(prior)} (${prior.sourceNodeIds[0]}) vs ` +
            `${JSON.stringify(entry)} (${n.id})`,
        );
      }
      prior.sourceNodeIds.push(n.id);
    }
  }
  return byCount;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const calibrationFlow = JSON.parse(readFileSync(opts.flow, 'utf8'));

  const settings = await api(opts.url, '/settings');
  const version = settings.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Could not read Node-RED version from /settings');
  }
  console.log(`Node-RED ${version} at ${opts.url}`);

  await dismissEditorModals(opts.url, version);
  console.log('Editor modals dismissed (telemetry + welcome tour).');

  const priorFlows = await api(opts.url, '/flows');
  await api(opts.url, '/flows', {
    method: 'POST',
    body: calibrationFlow,
    headers: { 'Node-RED-Deployment-Type': 'full' },
  });
  console.log(`Calibration flow deployed (${calibrationFlow.length} objects).`);

  let raw;
  const chrome = await launchChrome({ chromePath: opts.chrome });
  try {
    const session = await connect({ port: chrome.port });
    await session.navigate(`${opts.url}/`);
    await session.waitFor(`(${pageReady.toString()})()`, { timeoutMs: 60_000, pollMs: 400 });
    raw = await session.dump(`(${pageDump.toString()})()`);
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

  if (raw.version !== version) {
    throw new Error(`Version mismatch: /settings says ${version}, editor says ${raw.version}`);
  }
  const comments = raw.nodes.filter((n) => n.type === 'comment');
  const nodes = raw.nodes.filter((n) => n.type !== 'comment');

  const fixture = {
    schema: 'flow-otter/editor-metrics@1',
    nodeRedVersion: version,
    capturedAt: new Date().toISOString(),
    capture: {
      tool: 'scripts/editor-metrics-dump.mjs',
      url: opts.url,
      calibrationFlow: 'tests/fixtures/render/calibration-flow.json',
      platform: process.platform,
      userAgent: raw.userAgent,
    },
    assumptions: {
      'nodered-4.0.x':
        'Assumed dimension-identical to 4.1.x: the node-appearance rework shipped in 5.0. No 4.0 capture leg was run; if a 4.0 container is handy, re-run this script against it and commit the third fixture.',
    },
    labelStyle: raw.labelStyle,
    nodes,
    comments,
    junctions: raw.junctions,
    groups: raw.groups,
    outputPortOffsets: derivePortOffsets(nodes),
  };

  if (nodes.length === 0) throw new Error('Capture produced zero nodes — selector drift?');
  if (fixture.junctions.length === 0) throw new Error('Capture produced zero junctions.');
  if (fixture.groups.length === 0) throw new Error('Capture produced zero groups.');
  if (comments.length === 0) throw new Error('Capture produced zero comments.');
  if (fixture.labelStyle === null) throw new Error('Label computed style not captured.');

  mkdirSync(opts.outDir, { recursive: true });
  const outPath = join(opts.outDir, `nodered-${version}.json`);
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');

  const ladder = nodes
    .filter((n) => n.id.startsWith('calib-lad-'))
    .map((n) => `${n.id.slice(-2)}:${n.model.w}`)
    .join(' ');
  console.log(`Ladder widths (len:w): ${ladder}`);
  console.log(
    `Captured ${nodes.length} nodes, ${comments.length} comments, ` +
      `${fixture.junctions.length} junctions, ${fixture.groups.length} groups.`,
  );
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(1);
});
