import {
  hasCanvasPosition,
  isComment,
  isGroup,
  isJunction,
  isRegularNode,
  isTab,
  type FlowsJson,
  type FlowsJsonNode,
} from '../../shared/flows-json.js';
import { findLinkCallTargets } from '../validate/rules/_function-ast.js';

export interface ExplainNode {
  readonly id: string;
  readonly type: string;
  readonly label?: string;
}

export interface ExplainEdge {
  readonly fromId: string;
  readonly outputPort: number;
  readonly toId: string;
  readonly kind: 'wire' | 'link' | 'linkcall';
}

export interface ExplainReport {
  readonly tabId: string;
  readonly tabLabel: string;
  readonly entrypoints: readonly ExplainNode[];
  readonly sinks: readonly ExplainNode[];
  readonly orphans: readonly ExplainNode[];
  readonly nodes: readonly ExplainNode[];
  readonly edges: readonly ExplainEdge[];
  readonly notes: readonly string[];
}

const ENTRYPOINT_TYPES = new Set([
  'inject',
  'http in',
  'mqtt in',
  'link in',
  'status',
  'catch',
  'complete',
  'websocket in',
  'tcp in',
  'udp in',
  'amqp in',
  'serial in',
  'cron',
]);

const SINK_TYPES = new Set([
  'debug',
  'http response',
  'mqtt out',
  'link out',
  'websocket out',
  'tcp out',
  'udp out',
  'amqp out',
  'serial out',
  'file',
  'email',
  'exec',
]);

const LINK_IN = 'link in';
const LINK_OUT = 'link out';
const LINK_CALL = 'link call';

function nodeLabel(node: FlowsJsonNode): string | undefined {
  if ('name' in node && typeof node.name === 'string' && node.name.length > 0) return node.name;
  if ('label' in node && typeof node.label === 'string' && node.label.length > 0) return node.label;
  return undefined;
}

function toExplainNode(node: FlowsJsonNode): ExplainNode {
  const label = nodeLabel(node);
  return {
    id: node.id,
    type: node.type,
    ...(label !== undefined ? { label } : {}),
  };
}

function wiresOf(node: FlowsJsonNode): readonly (readonly string[])[] {
  if (isRegularNode(node)) return node.wires ?? [];
  if (isJunction(node)) return node.wires;
  return [];
}

function tabIdOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function linksOf(node: FlowsJsonNode): string[] {
  const raw = (node as { links?: unknown }).links;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === 'string');
}

function isDynamicLink(node: FlowsJsonNode): boolean {
  const linkType = (node as { linkType?: unknown }).linkType;
  return linkType === 'dynamic';
}

function nameOf(node: FlowsJsonNode): string | undefined {
  const name = (node as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function functionCodeOf(node: FlowsJsonNode): string | undefined {
  const code = (node as { func?: unknown }).func;
  return typeof code === 'string' ? code : undefined;
}

function tabLabelOrId(tabLabels: ReadonlyMap<string, string>, tabId: string): string {
  const label = tabLabels.get(tabId);
  return label !== undefined && label.length > 0 ? label : tabId;
}

function buildTabLabels(flows: FlowsJson): Map<string, string> {
  const labels = new Map<string, string>();
  for (const node of flows) {
    if (isTab(node)) labels.set(node.id, node.label);
  }
  return labels;
}

function buildNodeById(flows: FlowsJson): Map<string, FlowsJsonNode> {
  const byId = new Map<string, FlowsJsonNode>();
  for (const node of flows) byId.set(node.id, node);
  return byId;
}

function buildLinkInsByName(flows: FlowsJson): Map<string, FlowsJsonNode> {
  const byName = new Map<string, FlowsJsonNode>();
  for (const node of flows) {
    if (node.type !== LINK_IN) continue;
    const name = nameOf(node);
    if (name !== undefined && !byName.has(name)) byName.set(name, node);
  }
  return byName;
}

function resolveLinkInById(
  byId: ReadonlyMap<string, FlowsJsonNode>,
  id: string,
): FlowsJsonNode | undefined {
  const node = byId.get(id);
  return node?.type === LINK_IN ? node : undefined;
}

function resolveLinkCallTarget(
  target: string,
  byId: ReadonlyMap<string, FlowsJsonNode>,
  linkInsByName: ReadonlyMap<string, FlowsJsonNode>,
): FlowsJsonNode | undefined {
  const byExactId = resolveLinkInById(byId, target);
  if (byExactId !== undefined) return byExactId;
  return linkInsByName.get(target);
}

export function explainFlow(flows: FlowsJson, tabId: string): ExplainReport {
  const tab = flows.find((n) => isTab(n) && n.id === tabId);
  if (!tab || !isTab(tab)) {
    throw new Error(`Tab '${tabId}' not found.`);
  }

  const tabNodes: FlowsJsonNode[] = flows.filter((n) => {
    if (isTab(n)) return false;
    if (isGroup(n) || isComment(n)) return false;
    if (!hasCanvasPosition(n)) return false;
    const z = (n as { z?: unknown }).z;
    return z === tabId;
  });

  const incoming = new Map<string, number>();
  for (const n of tabNodes) incoming.set(n.id, 0);
  const tabNodeIds = new Set(tabNodes.map((n) => n.id));
  const tabLabels = buildTabLabels(flows);
  const byId = buildNodeById(flows);
  const linkInsByName = buildLinkInsByName(flows);
  const edges: ExplainEdge[] = [];
  const notes: string[] = [];
  const virtualEdgeKeys = new Set<string>();
  const virtualOutgoing = new Set<string>();

  const emitVirtualEdge = (
    kind: 'link' | 'linkcall',
    fromId: string,
    toId: string,
    crossedTabId?: string,
  ): void => {
    const key = `${kind}\0${fromId}\0${toId}`;
    if (virtualEdgeKeys.has(key)) return;
    virtualEdgeKeys.add(key);
    edges.push({ fromId, outputPort: 0, toId, kind });
    if (tabNodeIds.has(fromId)) virtualOutgoing.add(fromId);
    if (tabNodeIds.has(toId)) incoming.set(toId, (incoming.get(toId) ?? 0) + 1);
    if (crossedTabId !== undefined) {
      notes.push(
        `Virtual ${kind} edge ${fromId} -> ${toId} crosses to tab '${tabLabelOrId(
          tabLabels,
          crossedTabId,
        )}'.`,
      );
    }
  };

  for (const n of tabNodes) {
    const wires = wiresOf(n);
    for (let port = 0; port < wires.length; port++) {
      const targets = wires[port] ?? [];
      for (const toId of targets) {
        edges.push({ fromId: n.id, outputPort: port, toId, kind: 'wire' });
        if (incoming.has(toId)) incoming.set(toId, (incoming.get(toId) ?? 0) + 1);
      }
    }
  }

  for (const n of tabNodes) {
    if ((n.type !== LINK_OUT && n.type !== LINK_CALL) || isDynamicLink(n)) continue;
    for (const peerId of linksOf(n)) {
      const peer = resolveLinkInById(byId, peerId);
      if (peer === undefined) continue;
      const targetTab = tabIdOf(peer);
      emitVirtualEdge(
        'link',
        n.id,
        peer.id,
        targetTab !== undefined && targetTab !== tabId ? targetTab : undefined,
      );
    }
  }

  for (const n of tabNodes) {
    if (n.type !== LINK_IN) continue;
    for (const peerId of linksOf(n)) {
      const peer = byId.get(peerId);
      if (
        peer === undefined ||
        (peer.type !== LINK_OUT && peer.type !== LINK_CALL) ||
        isDynamicLink(peer)
      ) {
        continue;
      }
      const sourceTab = tabIdOf(peer);
      if (sourceTab === undefined || sourceTab === tabId) continue;
      emitVirtualEdge('link', peer.id, n.id, sourceTab);
    }
  }

  for (const n of tabNodes) {
    if (n.type !== 'function') continue;
    const code = functionCodeOf(n);
    if (code === undefined || code.length === 0) continue;
    for (const target of findLinkCallTargets(code)) {
      const linkIn = resolveLinkCallTarget(target, byId, linkInsByName);
      if (linkIn === undefined) continue;
      const targetTab = tabIdOf(linkIn);
      emitVirtualEdge(
        'linkcall',
        n.id,
        linkIn.id,
        targetTab !== undefined && targetTab !== tabId ? targetTab : undefined,
      );
    }
  }

  const entrypoints: ExplainNode[] = [];
  const sinks: ExplainNode[] = [];
  const orphans: ExplainNode[] = [];
  const nodes: ExplainNode[] = [];

  for (const n of tabNodes) {
    nodes.push(toExplainNode(n));
    const inn = incoming.get(n.id) ?? 0;
    const outgoing = hasOutgoing(n) || virtualOutgoing.has(n.id);

    if (ENTRYPOINT_TYPES.has(n.type) || (inn === 0 && outgoing)) {
      entrypoints.push(toExplainNode(n));
    }
    if (SINK_TYPES.has(n.type) || (!outgoing && inn !== 0)) {
      sinks.push(toExplainNode(n));
    }
    if (inn === 0 && !outgoing) {
      orphans.push(toExplainNode(n));
    }
  }

  if (entrypoints.length === 0) notes.push('No entrypoints detected on this tab.');
  if (sinks.length === 0) notes.push('No sinks detected on this tab.');
  if (orphans.length > 0)
    notes.push(`${orphans.length} orphan node(s) (no inbound or outbound wires).`);

  return {
    tabId,
    tabLabel: tab.label,
    entrypoints,
    sinks,
    orphans,
    nodes,
    edges,
    notes,
  };
}

function hasOutgoing(node: FlowsJsonNode): boolean {
  return wiresOf(node).some((arr) => arr.length > 0);
}
