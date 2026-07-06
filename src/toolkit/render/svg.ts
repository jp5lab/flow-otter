/**
 * Deterministic SVG renderer + render geometry (REND-3).
 *
 * Geometry rules (editor-true, pinned by the REND-1 fixtures via metrics.ts):
 *   - Node and comment x/y are CENTER anchors (the editor convention);
 *     group x/y/w/h is a top-left bounding box, exactly as in flows.json.
 *   - Node dimensions come from `nodeDimensionsFor` (frozen contract #2);
 *     ports from `outputPortAnchors`/`inputPortAnchor`.
 *   - Output-port counts read TOP-LEVEL `outputs`/`rules` via
 *     `getOutputPortCount(n.type, n)` (the phantom `passthrough` read is
 *     dead); subflow instances take their port counts from the subflow
 *     definition's `in`/`out` arrays.
 *   - Junctions are 10×10 waypoints centered on (x, y), drawn as r=5
 *     circles, and participate in the wire walk via `wires[0]`.
 *   - Config nodes never render: a node referenced from ANOTHER node's
 *     scalar string prop (excluding wires/links/scope/g/z/d/id) is
 *     config-by-reference and excluded — renderer-side workaround for
 *     stamped canvas fields on config nodes (audit e1#9; root cause WSB-8) —
 *     with `isConfigNode` / non-regular shape checks as belt-and-braces.
 *   - The whole body is translated so negative extents (center-anchored
 *     nodes near the origin, port overhang included) are never clipped.
 *
 * `renderGeometry(flows, tabId)` is frozen contract #1: the per-node
 * `{id, x, y, w, h, ports[]}` array (center-convention, post-translate)
 * consumed by the REND-7 editor-fidelity comparator, EVAL-4 blind packs and
 * `render_flow_png include_geometry`. SVG coordinates equal geometry
 * coordinates exactly — the translate is applied arithmetically, not via a
 * transform attribute.
 */
import {
  configByReferenceIds,
  hasCanvasPosition,
  isComment,
  isConfigShapedNode,
  isGroup,
  isJunction,
  isRegularNode,
  isSubflowDef,
  isSubflowInstance,
  isTab,
  SUBFLOW_INSTANCE_PREFIX,
  type FlowsJson,
  type FlowsJsonNode,
  type SubflowDefNode,
  type TabNode,
} from '../../shared/flows-json.js';
import { getInputPortCount, getOutputPortCount, isNodeLabelHidden } from '../authoring/types.js';

import { fitLabel, inputPortAnchor, nodeDimensionsFor, outputPortAnchors } from './metrics.js';

export interface RenderSvgOptions {
  /** Render only this tab. If omitted, renders the first tab. */
  tabId?: string;
  /** Background color (hex with #). */
  background?: string;
  /** Padding around the canvas. */
  padding?: number;
  /** Render every tab in the flows, stacked vertically. Overrides tabId. */
  allTabs?: boolean;
  /**
   * Optional set/list of installed node types. When present, nodes whose type
   * is not installed render with Node-RED's unknown-node fill.
   */
  installedTypes?: ReadonlySet<string> | readonly string[];
}

const DEFAULTS = {
  background: '#fafafa',
  padding: 24,
} as const;

const PORT_RADIUS = 5;
const PORT_FILL = '#d9d9d9';
const PORT_STROKE = '#999';
const JUNCTION_RADIUS = 5;
const JUNCTION_FILL = '#eeeeee';
const JUNCTION_SIZE = 10;
const TAB_GAP = 40;
const TAB_LABEL_OFFSET = 8;
const UNKNOWN_NODE_FILL = '#fee';

const TYPE_COLOR: Readonly<Record<string, string>> = {
  inject: '#a6bbcf',
  debug: '#87a980',
  function: '#fdd0a2',
  switch: '#e2d96e',
  change: '#e2d96e',
  template: '#fdf0c2',
  comment: '#ffffff',
  default: '#dddddd',
};

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colorFor(node: FlowsJsonNode): string {
  return TYPE_COLOR[node.type] ?? TYPE_COLOR['default']!;
}

function normalizeInstalledTypes(
  installedTypes: ReadonlySet<string> | readonly string[],
): ReadonlySet<string> {
  return installedTypes instanceof Set ? installedTypes : new Set(installedTypes);
}

function fillForNode(
  node: FlowsJsonNode,
  installedTypes: ReadonlySet<string> | undefined,
  subflowDefs: ReadonlyMap<string, SubflowDefNode>,
): string {
  if (installedTypes === undefined) return colorFor(node);
  if (isSubflowInstance(node)) {
    const defId = node.type.slice(SUBFLOW_INSTANCE_PREFIX.length);
    if (subflowDefs.has(defId)) return colorFor(node);
  }
  return installedTypes.has(node.type) ? colorFor(node) : UNKNOWN_NODE_FILL;
}

function findTab(flows: FlowsJson, tabId: string | undefined): TabNode | undefined {
  if (tabId !== undefined) {
    const tab = flows.find((n) => isTab(n) && n.id === tabId);
    if (tab && isTab(tab)) return tab;
    return undefined;
  }
  for (const n of flows) if (isTab(n)) return n;
  return undefined;
}

/** A rendered port (box center), in absolute post-translate canvas coordinates. */
export interface RenderGeometryPort {
  kind: 'input' | 'output';
  index: number;
  x: number;
  y: number;
}

/**
 * Frozen contract #1 — one per-canvas-object geometry entry:
 * `{id, x, y, w, h, ports[]}`, center-convention, post-translate. `kind` is
 * an additive discriminator (junctions have no id attribute in the editor
 * DOM, so fidelity comparators pair them by coordinates).
 */
export interface RenderGeometryEntry {
  id: string;
  kind: 'node' | 'junction' | 'group' | 'comment';
  /** Center x (groups are converted from their top-left bbox). */
  x: number;
  /** Center y (groups are converted from their top-left bbox). */
  y: number;
  w: number;
  h: number;
  ports: RenderGeometryPort[];
}

interface DrawNode {
  id: string;
  kind: 'node' | 'junction';
  cx: number;
  cy: number;
  w: number;
  h: number;
  label: string;
  hideLabel: boolean;
  fill: string;
  hasInput: boolean;
  inputPoint: { x: number; y: number };
  outputPoints: Array<{ x: number; y: number }>;
}

interface GroupBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  hasInfo: boolean;
}

interface CommentBox {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  label: string;
}

interface WireSegment {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface RequiredOpts {
  background: string;
  padding: number;
  installedTypes?: ReadonlySet<string>;
}

interface GeometryOpts {
  installedTypes?: ReadonlySet<string>;
}

interface RenderedTab {
  body: string;
  width: number;
  height: number;
  label: string;
}

interface TabGeometry {
  drawNodes: DrawNode[];
  groups: GroupBox[];
  comments: CommentBox[];
  wires: WireSegment[];
  /** Geometry entries in flows order (frozen contract #1). */
  entries: RenderGeometryEntry[];
  width: number;
  height: number;
}

export function renderSvg(flows: FlowsJson, opts: RenderSvgOptions = {}): string {
  const required: RequiredOpts = {
    background: opts.background ?? DEFAULTS.background,
    padding: opts.padding ?? DEFAULTS.padding,
    ...(opts.installedTypes !== undefined
      ? { installedTypes: normalizeInstalledTypes(opts.installedTypes) }
      : {}),
  };

  if (opts.allTabs) {
    const tabs = flows.filter(isTab);
    if (tabs.length === 0) {
      return svgRoot(0, 0, required.background, '');
    }
    const rendered = tabs.map((t) => renderTab(t, flows, required));
    let totalHeight = 0;
    let maxWidth = 0;
    const parts: string[] = [];
    for (let i = 0; i < rendered.length; i++) {
      const r = rendered[i]!;
      const yOffset = totalHeight + (i === 0 ? 0 : TAB_GAP);
      maxWidth = Math.max(maxWidth, r.width);
      parts.push(
        `<g transform="translate(0, ${fmt(yOffset)})">`,
        `  <text x="${fmt(0)}" y="${fmt(-TAB_LABEL_OFFSET)}" font-family="Arial,sans-serif" font-size="12" fill="#333333" text-anchor="start">${escapeXml(r.label)}</text>`,
        `  ${r.body}`,
        '</g>',
      );
      totalHeight = yOffset + r.height;
    }
    return svgRoot(maxWidth, totalHeight, required.background, parts.join('\n  '));
  }

  const tab = findTab(flows, opts.tabId);
  if (!tab) {
    return svgRoot(0, 0, required.background, '');
  }
  const r = renderTab(tab, flows, required);
  return svgRoot(r.width, r.height, required.background, r.body);
}

/**
 * Frozen contract #1: per-node `{id, x, y, w, h, ports[]}` geometry for one
 * tab (the first tab when `tabId` is omitted; `[]` for an unknown tab id,
 * mirroring `renderSvg`'s empty canvas). Center-convention, post-translate —
 * the values equal the coordinates in the `renderSvg` output byte-for-byte.
 */
export function renderGeometry(flows: FlowsJson, tabId?: string): RenderGeometryEntry[] {
  const tab = findTab(flows, tabId);
  if (!tab) return [];
  return computeTabGeometry(tab, flows).entries;
}

function wiresOf(n: FlowsJsonNode): string[][] {
  const wires = (n as { wires?: unknown }).wires;
  if (!Array.isArray(wires)) return [];
  return wires as string[][];
}

function computeTabGeometry(tab: TabNode, flows: FlowsJson): TabGeometry {
  return computeTabGeometryForRender(tab, flows, {});
}

function computeTabGeometryForRender(
  tab: TabNode,
  flows: FlowsJson,
  opts: GeometryOpts,
): TabGeometry {
  const tabNodes = flows.filter(
    (n): n is FlowsJsonNode & { x: number; y: number } =>
      hasCanvasPosition(n) && (n as { z?: string }).z === tab.id,
  );

  const subflowDefs = new Map<string, SubflowDefNode>();
  for (const n of flows) if (isSubflowDef(n)) subflowDefs.set(n.id, n);

  const configIds = configByReferenceIds(flows);

  const drawNodes: DrawNode[] = [];
  const groups: GroupBox[] = [];
  const comments: CommentBox[] = [];
  const drawById = new Map<string, DrawNode>();
  const groupById = new Map<string, GroupBox>();
  const commentById = new Map<string, CommentBox>();

  for (const n of tabNodes) {
    const rawName =
      typeof (n as { name?: string }).name === 'string' ? (n as { name: string }).name : '';
    if (isGroup(n)) {
      const gw = (n as { w?: number }).w ?? 200;
      const gh = (n as { h?: number }).h ?? 100;
      const info = (n as { info?: unknown }).info;
      const g: GroupBox = {
        id: n.id,
        x: n.x,
        y: n.y,
        w: gw,
        h: gh,
        label: rawName,
        hasInfo: typeof info === 'string' && info.length > 0,
      };
      groups.push(g);
      groupById.set(n.id, g);
      continue;
    }
    if (isComment(n)) {
      const explicitW = (n as { w?: number }).w;
      const explicitH = (n as { h?: number }).h;
      // Same sizing as compile's auto-fit: explicit size wins, otherwise the
      // editor measures comments through the standard label formula.
      const measured = nodeDimensionsFor(rawName, { inputs: 0, outputs: 0 });
      const c: CommentBox = {
        id: n.id,
        cx: n.x,
        cy: n.y,
        w: explicitW ?? measured.w,
        h: explicitH ?? measured.h,
        label: rawName,
      };
      comments.push(c);
      commentById.set(n.id, c);
      continue;
    }
    if (isJunction(n)) {
      const j: DrawNode = {
        id: n.id,
        kind: 'junction',
        cx: n.x,
        cy: n.y,
        w: JUNCTION_SIZE,
        h: JUNCTION_SIZE,
        label: '',
        hideLabel: true,
        fill: JUNCTION_FILL,
        hasInput: true,
        // Junction wires attach at the waypoint itself.
        inputPoint: { x: n.x, y: n.y },
        outputPoints: [{ x: n.x, y: n.y }],
      };
      drawNodes.push(j);
      drawById.set(n.id, j);
      continue;
    }
    // Config nodes never render: config-by-reference is the primary signal
    // (stamped canvas fields, e1#9); the shape checks are belt-and-braces.
    if (isConfigShapedNode(n, configIds) || !isRegularNode(n)) continue;

    const rec = n as Record<string, unknown>;
    let inputs: number;
    let outputs: number;
    if (isSubflowInstance(n)) {
      const def = subflowDefs.get(n.type.slice(SUBFLOW_INSTANCE_PREFIX.length));
      inputs = def?.in?.length ?? 1;
      outputs = def?.out?.length ?? 1;
    } else {
      inputs = getInputPortCount(n.type, rec);
      outputs = getOutputPortCount(n.type, rec);
    }
    // Degenerate-input guard: every wire row must own a port so wire
    // endpoints always equal port coordinates. Valid flows always satisfy
    // wires.length === outputs already.
    outputs = Math.max(outputs, wiresOf(n).length);
    const hideLabel = isNodeLabelHidden(n.type, rec);
    const label = rawName !== '' ? rawName : n.type;
    const { w, h } = nodeDimensionsFor(label, { inputs, outputs, hideLabel });
    const left = n.x - w / 2;
    const top = n.y - h / 2;
    const inAnchor = inputPortAnchor(h);
    const box: DrawNode = {
      id: n.id,
      kind: 'node',
      cx: n.x,
      cy: n.y,
      w,
      h,
      label,
      hideLabel,
      fill: fillForNode(n, opts.installedTypes, subflowDefs),
      hasInput: inputs > 0,
      inputPoint: { x: left + inAnchor.x, y: top + inAnchor.y },
      outputPoints: outputPortAnchors(w, h, outputs).map((a) => ({
        x: left + a.x,
        y: top + a.y,
      })),
    };
    drawNodes.push(box);
    drawById.set(n.id, box);
  }

  const wires: WireSegment[] = [];
  for (const n of tabNodes) {
    const fromBox = drawById.get(n.id);
    if (!fromBox) continue;
    // Junctions have a single output port: walk wires[0] only.
    const rows = fromBox.kind === 'junction' ? wiresOf(n).slice(0, 1) : wiresOf(n);
    for (let port = 0; port < rows.length; port++) {
      const from = fromBox.outputPoints[port];
      if (!from) continue;
      for (const targetId of rows[port] ?? []) {
        const targetBox = drawById.get(targetId);
        // Excluded (config) or off-tab targets draw no wire.
        if (!targetBox) continue;
        wires.push({ from: { ...from }, to: { ...targetBox.inputPoint } });
      }
    }
  }

  // Extents (port overhang included) drive the whole-body translate: nothing
  // may render at negative coordinates, so center-anchored nodes at or near
  // the origin stay fully visible.
  let xMin = 0;
  let yMin = 0;
  let xMax = 0;
  let yMax = 0;
  for (const b of drawNodes) {
    // Junction ports attach at the waypoint center — no port overhang.
    const inOverhang = b.kind === 'node' && b.hasInput ? PORT_RADIUS : 0;
    const outOverhang = b.kind === 'node' && b.outputPoints.length > 0 ? PORT_RADIUS : 0;
    xMin = Math.min(xMin, b.cx - b.w / 2 - inOverhang);
    yMin = Math.min(yMin, b.cy - b.h / 2);
    xMax = Math.max(xMax, b.cx + b.w / 2 + outOverhang);
    yMax = Math.max(yMax, b.cy + b.h / 2);
  }
  for (const g of groups) {
    xMin = Math.min(xMin, g.x);
    yMin = Math.min(yMin, g.y);
    xMax = Math.max(xMax, g.x + g.w);
    yMax = Math.max(yMax, g.y + g.h);
  }
  for (const c of comments) {
    xMin = Math.min(xMin, c.cx - c.w / 2);
    yMin = Math.min(yMin, c.cy - c.h / 2);
    xMax = Math.max(xMax, c.cx + c.w / 2);
    yMax = Math.max(yMax, c.cy + c.h / 2);
  }
  const tx = -xMin;
  const ty = -yMin;
  if (tx !== 0 || ty !== 0) {
    for (const b of drawNodes) {
      b.cx += tx;
      b.cy += ty;
      b.inputPoint.x += tx;
      b.inputPoint.y += ty;
      for (const p of b.outputPoints) {
        p.x += tx;
        p.y += ty;
      }
    }
    for (const g of groups) {
      g.x += tx;
      g.y += ty;
    }
    for (const c of comments) {
      c.cx += tx;
      c.cy += ty;
    }
    for (const wire of wires) {
      wire.from.x += tx;
      wire.from.y += ty;
      wire.to.x += tx;
      wire.to.y += ty;
    }
  }

  // Geometry entries in flows order (frozen contract #1).
  const entries: RenderGeometryEntry[] = [];
  for (const n of tabNodes) {
    const g = groupById.get(n.id);
    if (g) {
      entries.push({
        id: g.id,
        kind: 'group',
        x: g.x + g.w / 2,
        y: g.y + g.h / 2,
        w: g.w,
        h: g.h,
        ports: [],
      });
      continue;
    }
    const c = commentById.get(n.id);
    if (c) {
      entries.push({ id: c.id, kind: 'comment', x: c.cx, y: c.cy, w: c.w, h: c.h, ports: [] });
      continue;
    }
    const b = drawById.get(n.id);
    if (!b) continue;
    const ports: RenderGeometryPort[] = [];
    if (b.hasInput) {
      ports.push({ kind: 'input', index: 0, x: b.inputPoint.x, y: b.inputPoint.y });
    }
    for (let i = 0; i < b.outputPoints.length; i++) {
      const p = b.outputPoints[i]!;
      ports.push({ kind: 'output', index: i, x: p.x, y: p.y });
    }
    entries.push({ id: b.id, kind: b.kind, x: b.cx, y: b.cy, w: b.w, h: b.h, ports });
  }

  return {
    drawNodes,
    groups,
    comments,
    wires,
    entries,
    width: xMax + tx,
    height: yMax + ty,
  };
}

function renderTab(tab: TabNode, flows: FlowsJson, opts: RequiredOpts): RenderedTab {
  const geo = computeTabGeometryForRender(tab, flows, opts);

  const parts: string[] = [];
  for (const g of geo.groups) {
    parts.push(groupRect(g.x, g.y, g.w, g.h));
    if (g.label) parts.push(text(g.x + 8, g.y + 16, g.label, '#666666', 12));
    if (g.hasInfo) parts.push(groupInfoBadge(g));
  }
  for (const c of geo.comments) {
    const left = c.cx - c.w / 2;
    const top = c.cy - c.h / 2;
    parts.push(commentRect(left, top, c.w, c.h));
    if (c.label) parts.push(text(left + 8, top + 16, c.label, '#333333', 12));
  }
  for (const wire of geo.wires) {
    parts.push(wirePath(wire));
  }
  for (const b of geo.drawNodes) {
    if (b.kind === 'junction') {
      parts.push(circle(b.cx, b.cy, JUNCTION_RADIUS, JUNCTION_FILL, PORT_STROKE, 1));
      continue;
    }
    const left = b.cx - b.w / 2;
    const top = b.cy - b.h / 2;
    parts.push(rect(left, top, b.w, b.h, b.fill, '#888888', 1));
    if (!b.hideLabel) {
      parts.push(text(b.cx, b.cy + 4, fitLabelToBox(b.label, b.w), '#222222', 12, 'middle'));
    }
    if (b.hasInput) {
      parts.push(circle(b.inputPoint.x, b.inputPoint.y, PORT_RADIUS, PORT_FILL, PORT_STROKE, 1));
    }
    for (const p of b.outputPoints) {
      parts.push(circle(p.x, p.y, PORT_RADIUS, PORT_FILL, PORT_STROKE, 1));
    }
  }

  return {
    body: parts.join('\n  '),
    width: geo.width + opts.padding,
    height: geo.height + opts.padding,
    label: tab.label,
  };
}

function fitLabelToBox(label: string, boxWidthPx: number): string {
  const interiorPx = boxWidthPx - 24;
  if (interiorPx <= 0) return label;
  const maxUnits = Math.round((interiorPx * 1000) / 12);
  return fitLabel(label, maxUnits);
}

function svgRoot(width: number, height: number, bg: string, body: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" viewBox="0 0 ${fmt(width)} ${fmt(height)}">`,
    `  <rect width="${fmt(width)}" height="${fmt(height)}" fill="${bg}"/>`,
    `  ${body}`,
    '</svg>',
    '',
  ].join('\n');
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
): string {
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="4" ry="4" fill="${fill}" stroke="${stroke}" stroke-width="${fmt(strokeWidth)}"/>`;
}

function groupRect(x: number, y: number, w: number, h: number): string {
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="4" ry="4" fill="#ffffff" stroke="#a4a4a4" stroke-width="1" stroke-dasharray="4 2"/>`;
}

function groupInfoBadge(g: GroupBox): string {
  const x = g.x + g.w - 20;
  const y = g.y + 6;
  return [
    `<g data-flowotter-info-badge="${escapeXml(g.id)}">`,
    `  <rect x="${fmt(x)}" y="${fmt(y)}" width="12" height="12" rx="1" ry="1" fill="#ffffff" stroke="#777777" stroke-width="1"/>`,
    `  <path d="M ${fmt(x + 3)} ${fmt(y + 3)} H ${fmt(x + 9)} M ${fmt(x + 3)} ${fmt(y + 6)} H ${fmt(x + 9)} M ${fmt(x + 3)} ${fmt(y + 9)} H ${fmt(x + 7)}" stroke="#777777" stroke-width="1" fill="none"/>`,
    '</g>',
  ].join('\n  ');
}

function commentRect(x: number, y: number, w: number, h: number): string {
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="2" ry="2" fill="#ffffbf" stroke="#cdba66" stroke-width="1"/>`;
}

function circle(
  cx: number,
  cy: number,
  r: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
): string {
  return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${fmt(strokeWidth)}"/>`;
}

function text(
  x: number,
  y: number,
  content: string,
  fill: string,
  size: number,
  anchor: 'start' | 'middle' | 'end' = 'start',
): string {
  return `<text x="${fmt(x)}" y="${fmt(y)}" font-family="Arial,sans-serif" font-size="${fmt(size)}" fill="${fill}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}

function wirePath(seg: WireSegment): string {
  const { from, to } = seg;
  const dx = (to.x - from.x) / 2;
  const c1x = from.x + dx;
  const c1y = from.y;
  const c2x = to.x - dx;
  const c2y = to.y;
  return `<path d="M ${fmt(from.x)} ${fmt(from.y)} C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(to.x)} ${fmt(to.y)}" stroke="#888" stroke-width="2" fill="none"/>`;
}
