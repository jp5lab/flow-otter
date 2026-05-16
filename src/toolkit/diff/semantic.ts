import {
  isComment,
  isGroup,
  isSubflowDef,
  isTab,
  type FlowsJson,
  type FlowsJsonNode,
} from '../../shared/flows-json.js';

import { normalize } from './normalize.js';

export interface WireRef {
  readonly fromId: string;
  readonly outputPort: number;
  readonly toId: string;
}

export interface NodeChange {
  readonly id: string;
  readonly type: string;
  readonly tabId?: string;
}

export interface NodeModification {
  readonly id: string;
  readonly type: string;
  readonly tabId?: string;
  readonly fields: readonly string[];
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface SemanticDiff {
  readonly added: { readonly nodes: readonly NodeChange[]; readonly wires: readonly WireRef[] };
  readonly removed: { readonly nodes: readonly NodeChange[]; readonly wires: readonly WireRef[] };
  readonly modified: { readonly nodes: readonly NodeModification[] };
}

const WIRE_FIELD = 'wires';

function indexById(flows: FlowsJson): Map<string, FlowsJsonNode> {
  const m = new Map<string, FlowsJsonNode>();
  for (const n of flows) m.set(n.id, n);
  return m;
}

function nodeChange(n: FlowsJsonNode): NodeChange {
  const tabId = (n as { z?: string }).z;
  return {
    id: n.id,
    type: n.type,
    ...(typeof tabId === 'string' ? { tabId } : {}),
  };
}

function wiresFromNode(n: FlowsJsonNode): WireRef[] {
  if (isTab(n) || isSubflowDef(n) || isGroup(n) || isComment(n)) return [];
  const wires = (n as { wires?: string[][] }).wires ?? [];
  const result: WireRef[] = [];
  for (let port = 0; port < wires.length; port++) {
    const targets = wires[port] ?? [];
    for (const toId of targets) {
      result.push({ fromId: n.id, outputPort: port, toId });
    }
  }
  return result;
}

function indexWires(flows: FlowsJson): Map<string, WireRef> {
  const m = new Map<string, WireRef>();
  for (const n of flows) {
    for (const w of wiresFromNode(n)) {
      m.set(`${w.fromId}|${w.outputPort}|${w.toId}`, w);
    }
  }
  return m;
}

function diffFields(
  before: FlowsJsonNode,
  after: FlowsJsonNode,
): { fields: string[]; before: Record<string, unknown>; after: Record<string, unknown> } {
  const fields: string[] = [];
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    if (k === WIRE_FIELD) {
      // Wires are handled by the wire-level diff; skip from field-level diff
      continue;
    }
    const aJson = JSON.stringify(a);
    const bJson = JSON.stringify(b);
    if (aJson !== bJson) {
      fields.push(k);
      beforeOut[k] = a;
      afterOut[k] = b;
    }
  }
  fields.sort();
  return { fields, before: beforeOut, after: afterOut };
}

export function diffFlows(prior: FlowsJson, next: FlowsJson): SemanticDiff {
  const a = normalize(prior);
  const b = normalize(next);
  const aById = indexById(a);
  const bById = indexById(b);
  const aWires = indexWires(a);
  const bWires = indexWires(b);

  const addedNodes: NodeChange[] = [];
  const removedNodes: NodeChange[] = [];
  const modifiedNodes: NodeModification[] = [];

  for (const [id, node] of bById) {
    if (!aById.has(id)) addedNodes.push(nodeChange(node));
  }
  for (const [id, node] of aById) {
    if (!bById.has(id)) removedNodes.push(nodeChange(node));
  }
  for (const [id, before] of aById) {
    const after = bById.get(id);
    if (!after) continue;
    const { fields, before: beforeFields, after: afterFields } = diffFields(before, after);
    if (fields.length > 0) {
      const tabId = (after as { z?: string }).z;
      modifiedNodes.push({
        id,
        type: after.type,
        ...(typeof tabId === 'string' ? { tabId } : {}),
        fields,
        before: beforeFields,
        after: afterFields,
      });
    }
  }

  const addedWires: WireRef[] = [];
  const removedWires: WireRef[] = [];
  for (const [k, w] of bWires) {
    if (!aWires.has(k)) addedWires.push(w);
  }
  for (const [k, w] of aWires) {
    if (!bWires.has(k)) removedWires.push(w);
  }

  return {
    added: { nodes: addedNodes, wires: addedWires },
    removed: { nodes: removedNodes, wires: removedWires },
    modified: { nodes: modifiedNodes },
  };
}

export function summarizeDiff(d: SemanticDiff): {
  nodes_added: number;
  nodes_removed: number;
  nodes_modified: number;
  wires_added: number;
  wires_removed: number;
} {
  return {
    nodes_added: d.added.nodes.length,
    nodes_removed: d.removed.nodes.length,
    nodes_modified: d.modified.nodes.length,
    wires_added: d.added.wires.length,
    wires_removed: d.removed.wires.length,
  };
}
