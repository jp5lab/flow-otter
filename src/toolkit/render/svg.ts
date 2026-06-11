import {
  hasCanvasPosition,
  isComment,
  isGroup,
  isRegularNode,
  isTab,
  type FlowsJson,
  type FlowsJsonNode,
  type RegularNode,
  type TabNode,
} from '../../shared/flows-json.js';
import { getInputPortCount, getOutputPortCount } from '../authoring/types.js';

import { fitLabel, nodeDimensionsFor } from './metrics.js';

export interface RenderSvgOptions {
  /** Render only this tab. If omitted, renders the first tab. */
  tabId?: string;
  /** Background color (hex with #). */
  background?: string;
  /** Padding around the canvas. */
  padding?: number;
  /** Render every tab in the flows, stacked vertically. Overrides tabId. */
  allTabs?: boolean;
}

const DEFAULTS = {
  background: '#fafafa',
  padding: 24,
} as const;

const NODE_HEIGHT = 30;
const PORT_RADIUS = 5;
const PORT_FILL = '#d9d9d9';
const PORT_STROKE = '#999';
const TAB_GAP = 40;
const TAB_LABEL_OFFSET = 8;

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

function findTab(flows: FlowsJson, tabId: string | undefined): TabNode | undefined {
  if (tabId !== undefined) {
    const tab = flows.find((n) => isTab(n) && n.id === tabId);
    if (tab && isTab(tab)) return tab;
    return undefined;
  }
  for (const n of flows) if (isTab(n)) return n;
  return undefined;
}

interface NodeBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  fill: string;
  outputs: number;
  isRegular: boolean;
  isLinkIn: boolean;
}

interface GroupBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

interface CommentBox {
  x: number;
  y: number;
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
}

interface RenderedTab {
  body: string;
  width: number;
  height: number;
  label: string;
}

export function renderSvg(flows: FlowsJson, opts: RenderSvgOptions = {}): string {
  const required: RequiredOpts = {
    background: opts.background ?? DEFAULTS.background,
    padding: opts.padding ?? DEFAULTS.padding,
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

function renderTab(tab: TabNode, flows: FlowsJson, opts: RequiredOpts): RenderedTab {
  const tabNodes = flows.filter(
    (n): n is RegularNode | FlowsJsonNode =>
      hasCanvasPosition(n) && (n as { z?: string }).z === tab.id,
  );

  const idToNode = new Map<string, FlowsJsonNode>();
  for (const n of flows) idToNode.set(n.id, n);

  const boxes: NodeBox[] = [];
  const groups: GroupBox[] = [];
  const comments: CommentBox[] = [];
  const boxById = new Map<string, NodeBox>();

  for (const n of tabNodes) {
    if (!hasCanvasPosition(n)) continue;
    const rawName =
      typeof (n as { name?: string }).name === 'string' ? (n as { name: string }).name : '';
    if (isGroup(n)) {
      const gw = (n as { w?: number }).w ?? 200;
      const gh = (n as { h?: number }).h ?? 100;
      groups.push({ x: n.x, y: n.y, w: gw, h: gh, label: rawName });
      continue;
    }
    if (isComment(n)) {
      const cw = (n as { w?: number }).w ?? 160;
      const ch = (n as { h?: number }).h ?? 30;
      comments.push({ x: n.x, y: n.y, w: cw, h: ch, label: rawName });
      continue;
    }
    const passthrough = (n as { passthrough?: Record<string, unknown> }).passthrough;
    const outputs = isRegularNode(n) ? getOutputPortCount(n.type, passthrough) : 0;
    const label = rawName !== '' ? rawName : n.type;
    // Editor-true width (REND-2). Heights, anchors, ports and label-hidden
    // link pills are REND-3's renderer-geometry pass.
    const { w } = nodeDimensionsFor(label, {
      inputs: getInputPortCount(n.type, passthrough),
      outputs,
    });
    const fitted = fitLabelToBox(label, w);
    const box: NodeBox = {
      id: n.id,
      x: n.x,
      y: n.y,
      w,
      h: NODE_HEIGHT,
      label: fitted,
      fill: colorFor(n),
      outputs,
      isRegular: isRegularNode(n),
      isLinkIn: n.type === 'link in' || n.type === 'link_in',
    };
    boxes.push(box);
    boxById.set(n.id, box);
  }

  const wires: WireSegment[] = [];
  for (const n of tabNodes) {
    if (!isRegularNode(n)) continue;
    const fromBox = boxById.get(n.id);
    if (!fromBox) continue;
    const wiresArr = n.wires ?? [];
    for (let port = 0; port < wiresArr.length; port++) {
      const targets = wiresArr[port] ?? [];
      for (const targetId of targets) {
        const targetBox = boxById.get(targetId);
        if (!targetBox) {
          const target = idToNode.get(targetId);
          if (!target || !hasCanvasPosition(target)) continue;
          wires.push({
            from: { x: fromBox.x + fromBox.w, y: outputPortY(fromBox, port, fromBox.outputs) },
            to: { x: target.x, y: target.y + NODE_HEIGHT / 2 },
          });
          continue;
        }
        wires.push({
          from: { x: fromBox.x + fromBox.w, y: outputPortY(fromBox, port, fromBox.outputs) },
          to: { x: targetBox.x, y: targetBox.y + targetBox.h / 2 },
        });
      }
    }
  }

  let xMax = 0;
  let yMax = 0;
  for (const b of boxes) {
    xMax = Math.max(xMax, b.x + b.w);
    yMax = Math.max(yMax, b.y + b.h);
  }
  for (const g of groups) {
    xMax = Math.max(xMax, g.x + g.w);
    yMax = Math.max(yMax, g.y + g.h);
  }
  for (const c of comments) {
    xMax = Math.max(xMax, c.x + c.w);
    yMax = Math.max(yMax, c.y + c.h);
  }
  const width = xMax + opts.padding;
  const height = yMax + opts.padding;

  const parts: string[] = [];
  for (const g of groups) {
    parts.push(groupRect(g.x, g.y, g.w, g.h));
    if (g.label) parts.push(text(g.x + 8, g.y + 16, g.label, '#666666', 12));
  }
  for (const c of comments) {
    parts.push(commentRect(c.x, c.y, c.w, c.h));
    if (c.label) parts.push(text(c.x + 8, c.y + 16, c.label, '#333333', 12));
  }
  for (const wire of wires) {
    parts.push(wirePath(wire));
  }
  for (const box of boxes) {
    parts.push(rect(box.x, box.y, box.w, box.h, box.fill, '#888888', 1));
    parts.push(text(box.x + box.w / 2, box.y + box.h / 2 + 4, box.label, '#222222', 12, 'middle'));
    if (box.isRegular && !box.isLinkIn) {
      parts.push(circle(box.x, box.y + box.h / 2, PORT_RADIUS, PORT_FILL, PORT_STROKE, 1));
    }
    for (let i = 0; i < box.outputs; i++) {
      parts.push(
        circle(
          box.x + box.w,
          outputPortY(box, i, box.outputs),
          PORT_RADIUS,
          PORT_FILL,
          PORT_STROKE,
          1,
        ),
      );
    }
  }

  return {
    body: parts.join('\n  '),
    width,
    height,
    label: tab.label,
  };
}

function fitLabelToBox(label: string, boxWidthPx: number): string {
  const interiorPx = boxWidthPx - 24;
  if (interiorPx <= 0) return label;
  const maxUnits = Math.round((interiorPx * 1000) / 12);
  return fitLabel(label, maxUnits);
}

function outputPortY(box: NodeBox, port: number, totalPorts: number): number {
  return box.y + ((port + 1) * box.h) / (totalPorts + 1);
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
