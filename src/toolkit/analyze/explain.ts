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

export interface ExplainNode {
  readonly id: string;
  readonly type: string;
  readonly label?: string;
}

export interface ExplainEdge {
  readonly fromId: string;
  readonly outputPort: number;
  readonly toId: string;
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
  const edges: ExplainEdge[] = [];
  for (const n of tabNodes) {
    const wires = wiresOf(n);
    for (let port = 0; port < wires.length; port++) {
      const targets = wires[port] ?? [];
      for (const toId of targets) {
        edges.push({ fromId: n.id, outputPort: port, toId });
        if (incoming.has(toId)) incoming.set(toId, (incoming.get(toId) ?? 0) + 1);
      }
    }
  }

  const entrypoints: ExplainNode[] = [];
  const sinks: ExplainNode[] = [];
  const orphans: ExplainNode[] = [];
  const nodes: ExplainNode[] = [];

  for (const n of tabNodes) {
    nodes.push(toExplainNode(n));
    const inn = incoming.get(n.id) ?? 0;
    const outgoing = hasOutgoing(n);

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

  const notes: string[] = [];
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
