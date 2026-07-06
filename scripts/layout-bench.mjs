#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'audit-2026-06-10');
const MANIFEST_PATH = path.join(FIXTURE_DIR, 'sha256-manifest.json');
const FIXTURES = [
  { name: 'e1-flows.json', tabId: 'f6f2187d.f17ca8', switchId: '3865da1cf3821d01' },
  { name: 'e2-flows.json', tabId: 'e2spag001', switchId: 'e2n05', junctionId: 'e2n12' },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readHashPinnedFixture(name, FlowsJsonSchema) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.schema_version !== 1 || manifest.algorithm !== 'sha256') {
    throw new Error('unsupported audit fixture hash manifest');
  }
  const expected = manifest.files?.[name];
  if (typeof expected !== 'string') throw new Error(`audit fixture '${name}' is not sha256-pinned`);

  const fixturePath = path.join(FIXTURE_DIR, name);
  const bytes = readFileSync(fixturePath);
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(
      `audit fixture sha256 mismatch for '${name}': expected ${expected}, got ${actual}`,
    );
  }

  const parsed = JSON.parse(bytes.toString('utf8'));
  return FlowsJsonSchema.parse(parsed.flows);
}

function stable(value) {
  if (Array.isArray(value)) return value.map((item) => stable(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

function sameFields(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function nodeById(flows, id) {
  const found = flows.find((node) => node.id === id);
  if (found === undefined) throw new Error(`missing node ${id}`);
  return found;
}

function wireTargets(node, port) {
  const row = Array.isArray(node.wires) ? node.wires[port] : undefined;
  return Array.isArray(row) ? row.filter((target) => typeof target === 'string') : [];
}

function firstWireTarget(flows, nodeId, port) {
  const targets = wireTargets(nodeById(flows, nodeId), port);
  if (targets.length !== 1) {
    throw new Error(`expected ${nodeId} port ${port} to have one target, got ${targets.length}`);
  }
  return targets[0];
}

function positionOf(metrics, id) {
  const position = metrics.positions.get(id);
  if (position === undefined) throw new Error(`missing position for ${id}`);
  return position;
}

function boundsOf(api, flows, tabId, id) {
  const bounds = api.layoutObjectBounds(flows, tabId, id);
  if (bounds === undefined) throw new Error(`missing geometry for ${id}`);
  return bounds;
}

function laneIds(api, flows, tabId, lane) {
  const derivation = api.deriveFlowsJsonLanes(flows).get(tabId);
  if (derivation === undefined) throw new Error(`missing lane derivation for ${tabId}`);
  return [...derivation.lanesById.entries()]
    .filter(([, foundLane]) => foundLane === lane)
    .map(([id]) => id);
}

function assertOnlyGeometryChanged(api, input, output, failures) {
  if (
    !sameFields(
      output.map((node) => node.id),
      input.map((node) => node.id),
    )
  ) {
    failures.push('node id order changed');
  }
  if (new Set(output.map((node) => node.id)).size !== input.length) {
    failures.push('node ids were added or removed');
  }
  if (!sameFields(api.stripLayoutGeometry(output), api.stripLayoutGeometry(input))) {
    failures.push('non-geometry fields changed');
  }
}

function assertAffirmativeOnTop(api, flows, tabId, switchId, failures) {
  const metrics = api.flowMetrics(flows, tabId);
  const out0 = firstWireTarget(flows, switchId, 0);
  const out1 = firstWireTarget(flows, switchId, 1);
  if (!(positionOf(metrics, out0).y < positionOf(metrics, out1).y)) {
    failures.push(`${switchId} port 0 target is not above port 1 target`);
  }
}

function checkHeaders(api, flows, tabId, failures) {
  const sections = api.deriveFlowsJsonSections(flows).get(tabId);
  if (sections === undefined) throw new Error(`missing sections for ${tabId}`);
  const pairs = [...sections.headerGroupIdByCommentId.entries()];
  if (pairs.length !== 6) failures.push(`expected 6 group headers, got ${pairs.length}`);

  const metrics = api.flowMetrics(flows, tabId);
  const seen = new Set();
  for (const [commentId, groupId] of pairs) {
    const headerBounds = boundsOf(api, flows, tabId, commentId);
    const groupBounds = boundsOf(api, flows, tabId, groupId);
    if (!(headerBounds.y2 < groupBounds.y1)) {
      failures.push(`header ${commentId} is not strictly above group ${groupId}`);
    }
    if (api.horizontalOverlap(headerBounds, groupBounds) <= 0) {
      failures.push(`header ${commentId} does not x-overlap group ${groupId}`);
    }
    const position = positionOf(metrics, commentId);
    if (position.x === 0 && position.y === 0) failures.push(`header ${commentId} is at origin`);
    const key = `${position.x}:${position.y}`;
    if (seen.has(key)) failures.push(`header ${commentId} is co-located with another header`);
    seen.add(key);
  }
}

function checkGroups(api, flows, tabId, failures) {
  const groups = flows.filter((node) => node.type === 'group' && node.z === tabId);
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const first = groups[i];
      const second = groups[j];
      if ((first.g ?? '') !== (second.g ?? '')) continue;
      if (
        !api.rectsDisjoint(
          boundsOf(api, flows, tabId, first.id),
          boundsOf(api, flows, tabId, second.id),
        )
      ) {
        failures.push(`sibling groups ${first.id} and ${second.id} overlap`);
      }
    }
  }

  for (const group of groups) {
    const groupBounds = boundsOf(api, flows, tabId, group.id);
    for (const memberId of group.nodes) {
      if (!api.rectContains(groupBounds, boundsOf(api, flows, tabId, memberId))) {
        failures.push(`group ${group.id} does not contain member ${memberId}`);
      }
    }
  }
}

function laneSeparation(api, flows, tabId) {
  const metrics = api.flowMetrics(flows, tabId);
  const mainYs = laneIds(api, flows, tabId, 'main').map((id) => positionOf(metrics, id).y);
  const errorYs = laneIds(api, flows, tabId, 'error').map((id) => positionOf(metrics, id).y);
  if (mainYs.length === 0 || errorYs.length === 0) return null;
  return Math.min(...errorYs) - Math.max(...mainYs);
}

function widthOverflowDiagnostics(diagnostics, tabId) {
  return diagnostics.filter(
    (diagnostic) => diagnostic.rule === 'layout/width-overflow' && diagnostic.tabId === tabId,
  );
}

function widthContract(api, diagnostics, tabId, width) {
  const budget = api.SPATIAL_SCAFFOLD_VISIBLE_WIDTH;
  if (width <= budget) {
    return {
      ok: true,
      status: `width ${width} <= ${budget}: PASS`,
    };
  }

  const matching = widthOverflowDiagnostics(diagnostics, tabId);
  if (
    matching.length === 1 &&
    matching[0]?.severity === 'warning' &&
    matching[0]?.context?.width === width &&
    matching[0]?.context?.targetWidth === budget
  ) {
    return {
      ok: true,
      status: `width ${width} > ${budget} - diagnosed layout/width-overflow: PASS (contract)`,
    };
  }

  return {
    ok: false,
    status: `width ${width} > ${budget} without matching layout/width-overflow diagnostic`,
  };
}

function otherTabNodeJson(flows, tabId) {
  return flows
    .filter((node) => node.id === tabId || node.z === tabId)
    .map((node) => JSON.stringify(node));
}

function e2WithSiblingTab(flows, FlowsJsonSchema) {
  return FlowsJsonSchema.parse([
    ...flows,
    { id: 'e2-sibling-tab', type: 'tab', label: 'Untouched sibling' },
    {
      id: 'e2-sibling-fn',
      type: 'function',
      z: 'e2-sibling-tab',
      x: 111,
      y: 222,
      wires: [[]],
      name: 'Untouched function',
      func: 'return msg;',
      outputs: 1,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
    },
  ]);
}

function checkE1(api, input, output, diagnostics) {
  const failures = [];
  const metrics = api.flowMetrics(output, FIXTURES[0].tabId);
  const width = api.tabBoundingExtent(output, FIXTURES[0].tabId).w;
  const separation = laneSeparation(api, output, FIXTURES[0].tabId);
  const widthResult = widthContract(api, diagnostics, FIXTURES[0].tabId, width);

  assertOnlyGeometryChanged(api, input, output, failures);
  if (separation === null || separation < api.LANE_GAP) {
    failures.push(`error lane separation ${separation ?? 'n/a'} < ${api.LANE_GAP}`);
  }
  assertAffirmativeOnTop(api, output, FIXTURES[0].tabId, FIXTURES[0].switchId, failures);
  checkHeaders(api, output, FIXTURES[0].tabId, failures);
  checkGroups(api, output, FIXTURES[0].tabId, failures);
  if (metrics.backwardWires !== 0) failures.push(`backward wires ${metrics.backwardWires} !== 0`);
  if (!widthResult.ok) failures.push(widthResult.status);

  return { failures, metrics, width, separation, widthStatus: widthResult.status };
}

async function checkE2(api, FlowsJsonSchema, input, output, diagnostics) {
  const failures = [];
  const metrics = api.flowMetrics(output, FIXTURES[1].tabId);
  const width = api.tabBoundingExtent(output, FIXTURES[1].tabId).w;
  const separation = laneSeparation(api, output, FIXTURES[1].tabId);
  const widthResult = widthContract(api, diagnostics, FIXTURES[1].tabId, width);

  assertOnlyGeometryChanged(api, input, output, failures);
  const upstream = positionOf(metrics, FIXTURES[1].switchId);
  const junction = positionOf(metrics, FIXTURES[1].junctionId);
  const downstream = positionOf(metrics, firstWireTarget(output, FIXTURES[1].junctionId, 0));
  if (
    !(
      junction.x > Math.min(upstream.x, downstream.x) &&
      junction.x < Math.max(upstream.x, downstream.x)
    )
  ) {
    failures.push(`${FIXTURES[1].junctionId} is not between its wire neighbors`);
  }
  if (metrics.backwardWires !== 0) failures.push(`backward wires ${metrics.backwardWires} !== 0`);
  if (metrics.wireCrossings !== 0) failures.push(`wire crossings ${metrics.wireCrossings} !== 0`);
  assertAffirmativeOnTop(api, output, FIXTURES[1].tabId, FIXTURES[1].switchId, failures);
  if (laneIds(api, output, FIXTURES[1].tabId, 'error').length !== 0) {
    failures.push('expected zero error-lane nodes for e2 abstention');
  }
  if (!widthResult.ok) failures.push(widthResult.status);

  const scopedInput = e2WithSiblingTab(input, FlowsJsonSchema);
  const before = otherTabNodeJson(scopedInput, 'e2-sibling-tab');
  const scopedOutput = await api.layoutFlowsJson(scopedInput, { tabIds: [FIXTURES[1].tabId] });
  if (!sameFields(otherTabNodeJson(scopedOutput, 'e2-sibling-tab'), before)) {
    failures.push('scoped relayout changed sibling tab bytes');
  }

  return { failures, metrics, width, separation, widthStatus: widthResult.status };
}

async function importBuilt() {
  try {
    const [layout, lanes, spatial, shared] = await Promise.all([
      import(
        pathToFileURL(path.join(REPO_ROOT, 'dist', 'src', 'toolkit', 'layout', 'index.js')).href
      ),
      import(pathToFileURL(path.join(REPO_ROOT, 'dist', 'src', 'toolkit', 'lanes.js')).href),
      import(
        pathToFileURL(
          path.join(REPO_ROOT, 'dist', 'src', 'toolkit', 'layout', 'spatial-scaffold.js'),
        ).href
      ),
      import(pathToFileURL(path.join(REPO_ROOT, 'dist', 'src', 'shared', 'flows-json.js')).href),
    ]);
    return {
      ...layout,
      deriveFlowsJsonLanes: lanes.deriveFlowsJsonLanes,
      LANE_GAP: lanes.LANE_GAP,
      SPATIAL_SCAFFOLD_VISIBLE_WIDTH: spatial.SPATIAL_SCAFFOLD_VISIBLE_WIDTH,
      FlowsJsonSchema: shared.FlowsJsonSchema,
    };
  } catch (err) {
    throw new Error(
      `could not import built layout engine from dist; run npm run build first (${err})`,
    );
  }
}

async function main() {
  const api = await importBuilt();
  let failed = false;

  for (const fixture of FIXTURES) {
    const input = readHashPinnedFixture(fixture.name, api.FlowsJsonSchema);
    const started = performance.now();
    let output;
    const diagnostics = [];
    try {
      output = await api.layoutFlowsJson(input, {
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      });
    } catch (err) {
      failed = true;
      console.log(
        `${fixture.name}: FAIL layout threw in ${(performance.now() - started).toFixed(1)}ms`,
      );
      console.log(`  - ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const elapsed = performance.now() - started;
    const report =
      fixture.name === 'e1-flows.json'
        ? checkE1(api, input, output, diagnostics)
        : await checkE2(api, api.FlowsJsonSchema, input, output, diagnostics);
    if (report.failures.length > 0) failed = true;

    const separation = report.separation === null ? 'n/a' : report.separation;
    const status = report.failures.length === 0 ? 'PASS' : 'FAIL';
    console.log(
      `${fixture.name}: ${status} time=${elapsed.toFixed(1)}ms backward=${report.metrics.backwardWires} crossings=${report.metrics.wireCrossings} width=${report.width} lane_separation=${separation}`,
    );
    console.log(`  - ${report.widthStatus}`);
    for (const failure of report.failures) console.log(`  - ${failure}`);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
