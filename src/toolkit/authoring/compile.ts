import {
  type CommentNode,
  type FlowsJson,
  type FlowsJsonNode,
  type GroupNode,
  type JunctionNode,
  type RegularNode,
  type TabNode,
  SUBFLOW_INSTANCE_PREFIX,
} from '../../shared/flows-json.js';
import { canonicalHash } from '../../shared/hash.js';
import { generateNodeId } from '../../shared/ids.js';

import { byCanonicalOrder } from './ordering.js';
import {
  type AuthoringSpec,
  type CommentSpec,
  type ConfigNodeSpec,
  type ConnectionSpec,
  type GroupSpec,
  type JunctionSpec,
  type NodeSpec,
  type SubflowDefSpec,
  type TabSpec,
  getOutputPortCount,
} from './types.js';

export const AUTHORING_KEY_FIELD = '_authoringKey';

export interface CompileOptions {
  /** Existing flows to merge against — preserves IDs of unchanged nodes byte-for-byte. */
  prior?: FlowsJson;
  /** Layout algorithm. 'none' (the slice default) honors positions in the spec. */
  layoutAlgorithm?: 'none';
  /** 'fixed' is for tests that need predictable IDs from spec keys directly. */
  idStrategy?: 'hash' | 'fixed';
}

export interface CompileDiagnostic {
  readonly severity: 'error' | 'warning' | 'info';
  readonly rule: string;
  readonly message: string;
  readonly tabId?: string;
  readonly nodeKey?: string;
  readonly context?: Record<string, unknown>;
}

export interface CompileResult {
  flows: FlowsJson;
  hash: string;
  /**
   * Authoring-time diagnostics surfaced by the compiler — unresolved wire
   * targets, group members, parent-group refs, and widget anchors. The
   * compiler does not throw on these (a re-compile of a previously-dirty
   * flows.json must succeed) but callers (e.g. the stage pipeline) surface
   * them in tool output so agents see the data loss.
   */
  diagnostics: readonly CompileDiagnostic[];
}

type Kind = 'tab' | 'node' | 'group' | 'comment' | 'subflowDef' | 'config' | 'junction';

const AMBIGUOUS = Symbol('ambiguous');
type ByKindKeyVal = string | typeof AMBIGUOUS;

interface PriorIndex {
  /** `${tabId}:${kind}:${authoringKey}` → existing Node-RED id (exact match). */
  byTabKindKey: Map<string, string>;
  /**
   * `${kind}:${authoringKey}` → existing id, OR `AMBIGUOUS` if multiple prior
   * nodes share the same kind+key (e.g. same key on different tabs). The
   * cross-tab-move fallback uses this when the exact tab+kind+key lookup
   * misses, treating "key present in prior, just on a different tab" as a
   * move (preserve id). Ambiguous matches fall through to fresh generation.
   */
  byKindKey: Map<string, ByKindKeyVal>;
  /**
   * Every prior id, used as a legacy fallback when prior was authored
   * without `_authoringKey` (e.g. straight from the Node-RED editor).
   */
  allIds: Set<string>;
  /**
   * Ids already claimed by `deriveId` during this compile pass. Prevents two
   * new spec entries from claiming the same prior id when the byKindKey
   * fallback would otherwise hand it out twice.
   */
  reservedIds: Set<string>;
}

function kindOf(node: FlowsJsonNode): Kind {
  if (node.type === 'tab') return 'tab';
  if (node.type === 'subflow') return 'subflowDef';
  if (node.type === 'group') return 'group';
  if (node.type === 'comment') return 'comment';
  if (node.type === 'junction') return 'junction';
  if (!('z' in node) && !('x' in node) && !('y' in node) && !('wires' in node)) return 'config';
  return 'node';
}

function buildPriorIndex(prior: FlowsJson | undefined): PriorIndex {
  const idx: PriorIndex = {
    byTabKindKey: new Map(),
    byKindKey: new Map(),
    allIds: new Set(),
    reservedIds: new Set(),
  };
  if (!prior) return idx;
  for (const node of prior) {
    idx.allIds.add(node.id);
    const ext = (node as Record<string, unknown>)[AUTHORING_KEY_FIELD];
    if (typeof ext !== 'string') continue;
    const kind = kindOf(node);
    const containerId =
      kind === 'tab' || kind === 'subflowDef' || kind === 'config'
        ? node.id
        : ((node as { z?: string }).z ?? '');
    idx.byTabKindKey.set(`${containerId}:${kind}:${ext}`, node.id);
    const kk = `${kind}:${ext}`;
    const prev = idx.byKindKey.get(kk);
    if (prev === undefined) {
      idx.byKindKey.set(kk, node.id);
    } else if (prev !== node.id && prev !== AMBIGUOUS) {
      idx.byKindKey.set(kk, AMBIGUOUS);
    }
  }
  return idx;
}

function reserve(prior: PriorIndex, id: string): string {
  prior.reservedIds.add(id);
  return id;
}

function deriveId(
  prior: PriorIndex,
  containerId: string,
  kind: Kind,
  key: string,
  strategy: 'hash' | 'fixed',
): string {
  const exact = prior.byTabKindKey.get(`${containerId}:${kind}:${key}`);
  if (exact !== undefined && !prior.reservedIds.has(exact)) {
    return reserve(prior, exact);
  }
  const kk = prior.byKindKey.get(`${kind}:${key}`);
  if (typeof kk === 'string' && !prior.reservedIds.has(kk)) {
    return reserve(prior, kk);
  }
  if (prior.allIds.has(key) && !prior.reservedIds.has(key)) {
    return reserve(prior, key);
  }
  if (strategy === 'fixed') return reserve(prior, key);
  const seed =
    kind === 'tab' || kind === 'subflowDef' || kind === 'config'
      ? `${kind}:${key}`
      : `${containerId}:${kind}:${key}`;
  return reserve(prior, generateNodeId(seed));
}

function emitTab(spec: TabSpec, id: string): TabNode {
  const env = spec.env !== undefined ? spec.env.map((e) => ({ ...e })) : undefined;
  return {
    ...(spec.passthrough ?? {}),
    id,
    type: 'tab',
    label: spec.label,
    ...(spec.disabled !== undefined ? { disabled: spec.disabled } : {}),
    ...(spec.info !== undefined ? { info: spec.info } : {}),
    ...(spec.locked !== undefined ? { locked: spec.locked } : {}),
    ...(env !== undefined ? { env } : {}),
    [AUTHORING_KEY_FIELD]: spec.id,
  };
}

function emitNode(
  spec: NodeSpec,
  id: string,
  tabId: string,
  groupId: string | undefined,
  wires: string[][],
  configKeyToId: ReadonlyMap<string, string>,
  subflowDefKeyToId: ReadonlyMap<string, string>,
  diagnostics: CompileDiagnostic[],
): RegularNode {
  // Rewrite `subflow:<authoringKey>` → `subflow:<noderedId>` so the emitted
  // node references the compiled def by its real id. Without this, the
  // subflow-ports validator can't resolve the def at validation time.
  let effectiveType = spec.type;
  if (effectiveType.startsWith(SUBFLOW_INSTANCE_PREFIX)) {
    const defKey = effectiveType.slice(SUBFLOW_INSTANCE_PREFIX.length);
    const defId = subflowDefKeyToId.get(defKey);
    if (defId !== undefined) {
      effectiveType = `${SUBFLOW_INSTANCE_PREFIX}${defId}`;
    }
  }
  const node: Record<string, unknown> = {
    ...(spec.passthrough ?? {}),
    id,
    type: effectiveType,
    z: tabId,
    x: spec.position.x,
    y: spec.position.y,
    wires,
    [AUTHORING_KEY_FIELD]: spec.key,
  };
  if (spec.label !== undefined) node['name'] = spec.label;
  if (groupId !== undefined) node['g'] = groupId;
  if (spec.widgetAnchor !== undefined) {
    const targetId = configKeyToId.get(spec.widgetAnchor.refKey);
    if (targetId !== undefined) {
      node[spec.widgetAnchor.kind] = targetId;
    } else {
      diagnostics.push({
        severity: 'warning',
        rule: 'compile/unresolved-widget-anchor',
        message: `Node '${spec.key}' widgetAnchor.refKey '${spec.widgetAnchor.refKey}' was dropped: no matching config node.`,
        tabId,
        nodeKey: spec.key,
        context: { kind: spec.widgetAnchor.kind, refKey: spec.widgetAnchor.refKey },
      });
    }
  }
  return node as RegularNode;
}

function emitGroup(
  spec: GroupSpec,
  id: string,
  tabId: string,
  containedIds: string[],
  parentId: string | undefined,
): GroupNode {
  return {
    ...(spec.passthrough ?? {}),
    id,
    type: 'group',
    z: tabId,
    name: spec.name,
    nodes: containedIds,
    ...(spec.position !== undefined ? { x: spec.position.x, y: spec.position.y } : {}),
    ...(spec.size !== undefined ? { w: spec.size.w, h: spec.size.h } : {}),
    ...(parentId !== undefined ? { g: parentId } : {}),
    ...(spec.info !== undefined ? { info: spec.info } : {}),
    ...(spec.style !== undefined ? { style: spec.style } : {}),
    [AUTHORING_KEY_FIELD]: spec.key,
  };
}

function emitSubflowDef(spec: SubflowDefSpec, id: string): FlowsJsonNode {
  return {
    ...(spec.passthrough ?? {}),
    id,
    type: 'subflow',
    name: spec.name,
    [AUTHORING_KEY_FIELD]: spec.id,
  };
}

function emitConfigNode(spec: ConfigNodeSpec, id: string): RegularNode {
  const node: Record<string, unknown> = {
    ...(spec.passthrough ?? {}),
    id,
    type: spec.type,
    [AUTHORING_KEY_FIELD]: spec.key,
  };
  if (spec.label !== undefined) node['name'] = spec.label;
  return node as RegularNode;
}

function emitComment(
  spec: CommentSpec,
  id: string,
  tabId: string,
  groupId: string | undefined,
): CommentNode {
  return {
    id,
    type: 'comment',
    z: tabId,
    x: spec.position.x,
    y: spec.position.y,
    ...(spec.size !== undefined ? { w: spec.size.w, h: spec.size.h } : {}),
    name: spec.text,
    ...(spec.info !== undefined ? { info: spec.info } : {}),
    ...(groupId !== undefined ? { g: groupId } : {}),
    [AUTHORING_KEY_FIELD]: spec.key,
  };
}

function emitJunction(
  spec: JunctionSpec,
  id: string,
  tabId: string,
  groupId: string | undefined,
  wires: string[][],
): JunctionNode {
  return {
    id,
    type: 'junction',
    z: tabId,
    x: spec.position.x,
    y: spec.position.y,
    wires,
    ...(spec.name !== undefined ? { name: spec.name } : {}),
    ...(groupId !== undefined ? { g: groupId } : {}),
    ...(spec.disabled !== undefined ? { d: spec.disabled } : {}),
    [AUTHORING_KEY_FIELD]: spec.key,
  };
}

function buildWiresForNode(
  fromKey: string,
  portCount: number,
  connections: readonly ConnectionSpec[],
  tabId: string,
  diagnostics: CompileDiagnostic[],
  keyToId: Map<string, string>,
): string[][] {
  const wires: string[][] = [];
  for (let port = 0; port < portCount; port++) {
    const targets: string[] = [];
    for (const conn of connections) {
      if (conn.fromKey !== fromKey) continue;
      if (conn.outputPort !== port) continue;
      const targetId = keyToId.get(conn.toKey);
      if (targetId === undefined) {
        diagnostics.push({
          severity: 'warning',
          rule: 'compile/unresolved-wire-target',
          message: `Wire from '${fromKey}' port ${port} → '${conn.toKey}' was dropped: target key not present on this tab.`,
          tabId,
          nodeKey: fromKey,
          context: { outputPort: port, toKey: conn.toKey },
        });
        continue;
      }
      targets.push(targetId);
    }
    targets.sort();
    const deduped = [...new Set(targets)];
    wires.push(deduped);
  }
  return wires;
}

/**
 * Build a lookup of subflow-def-id → output port count, sourced from each
 * def's `passthrough.out` array. Without this, subflow-instance nodes get
 * `wires` sized to 1 even when the def declares multiple output ports — the
 * compiled flows.json then mismatches the def's actual port count.
 */
function buildSubflowDefOutCount(
  defs: readonly SubflowDefSpec[] | undefined,
): ReadonlyMap<string, number> {
  const m = new Map<string, number>();
  for (const def of defs ?? []) {
    const outArr = def.passthrough?.['out'];
    const count = Array.isArray(outArr) ? outArr.length : 1;
    m.set(def.id, count);
  }
  return m;
}

function portCountForNode(
  nodeSpec: NodeSpec,
  subflowDefOutCount: ReadonlyMap<string, number>,
): number {
  if (nodeSpec.type.startsWith(SUBFLOW_INSTANCE_PREFIX)) {
    const defId = nodeSpec.type.slice(SUBFLOW_INSTANCE_PREFIX.length);
    return subflowDefOutCount.get(defId) ?? 1;
  }
  return getOutputPortCount(nodeSpec.type, nodeSpec.passthrough);
}

export function compile(spec: AuthoringSpec, opts: CompileOptions = {}): CompileResult {
  const strategy = opts.idStrategy ?? 'hash';
  const prior = buildPriorIndex(opts.prior);
  const flows: FlowsJsonNode[] = [];
  const diagnostics: CompileDiagnostic[] = [];
  const subflowDefOutCount = buildSubflowDefOutCount(spec.subflowDefs);

  // Pre-resolve config-node ids so per-tab nodes can resolve `widgetAnchor`.
  // Reserving these ids up-front ensures the cross-tab-move fallback in
  // `deriveId` does not hand them out to a regular node by mistake.
  const configKeyToId = new Map<string, string>();
  for (const configSpec of spec.configNodes ?? []) {
    configKeyToId.set(configSpec.key, deriveId(prior, '', 'config', configSpec.key, strategy));
  }

  // Pre-resolve subflow-def ids so per-tab subflow-instance nodes can rewrite
  // `subflow:<authoringKey>` → `subflow:<noderedId>` at emit time. Without
  // this the subflow-ports validator can't find the def at validation time.
  const subflowDefKeyToId = new Map<string, string>();
  for (const defSpec of spec.subflowDefs ?? []) {
    subflowDefKeyToId.set(defSpec.id, deriveId(prior, '', 'subflowDef', defSpec.id, strategy));
  }

  for (const tabSpec of spec.tabs) {
    const tabId = deriveId(prior, '', 'tab', tabSpec.id, strategy);

    const nodeKeyToId = new Map<string, string>();
    for (const n of tabSpec.nodes) {
      nodeKeyToId.set(n.key, deriveId(prior, tabId, 'node', n.key, strategy));
    }
    const junctionKeyToId = new Map<string, string>();
    for (const j of tabSpec.junctions ?? []) {
      junctionKeyToId.set(j.key, deriveId(prior, tabId, 'junction', j.key, strategy));
    }
    const groupKeyToId = new Map<string, string>();
    for (const g of tabSpec.groups) {
      groupKeyToId.set(g.key, deriveId(prior, tabId, 'group', g.key, strategy));
    }
    const commentKeyToId = new Map<string, string>();
    for (const c of tabSpec.comments) {
      commentKeyToId.set(c.key, deriveId(prior, tabId, 'comment', c.key, strategy));
    }

    const wireTargetMap = new Map<string, string>([...nodeKeyToId, ...junctionKeyToId]);

    flows.push(emitTab(tabSpec, tabId));

    for (const nodeSpec of tabSpec.nodes) {
      const id = nodeKeyToId.get(nodeSpec.key);
      if (!id) continue;
      const portCount = portCountForNode(nodeSpec, subflowDefOutCount);
      const wires = buildWiresForNode(
        nodeSpec.key,
        portCount,
        tabSpec.connections,
        tabId,
        diagnostics,
        wireTargetMap,
      );
      let groupId: string | undefined;
      if (nodeSpec.groupKey !== undefined) {
        groupId = groupKeyToId.get(nodeSpec.groupKey);
        if (groupId === undefined) {
          diagnostics.push({
            severity: 'warning',
            rule: 'compile/unresolved-group-ref',
            message: `Node '${nodeSpec.key}' groupKey '${nodeSpec.groupKey}' was dropped: no group with that key on this tab.`,
            tabId,
            nodeKey: nodeSpec.key,
            context: { groupKey: nodeSpec.groupKey },
          });
        }
      }
      flows.push(
        emitNode(
          nodeSpec,
          id,
          tabId,
          groupId,
          wires,
          configKeyToId,
          subflowDefKeyToId,
          diagnostics,
        ),
      );
    }

    for (const junctionSpec of tabSpec.junctions ?? []) {
      const id = junctionKeyToId.get(junctionSpec.key);
      if (!id) continue;
      const wires = buildWiresForNode(
        junctionSpec.key,
        1,
        tabSpec.connections,
        tabId,
        diagnostics,
        wireTargetMap,
      );
      let groupId: string | undefined;
      if (junctionSpec.groupKey !== undefined) {
        groupId = groupKeyToId.get(junctionSpec.groupKey);
        if (groupId === undefined) {
          diagnostics.push({
            severity: 'warning',
            rule: 'compile/unresolved-group-ref',
            message: `Junction '${junctionSpec.key}' groupKey '${junctionSpec.groupKey}' was dropped: no group with that key on this tab.`,
            tabId,
            nodeKey: junctionSpec.key,
            context: { groupKey: junctionSpec.groupKey },
          });
        }
      }
      flows.push(emitJunction(junctionSpec, id, tabId, groupId, wires));
    }

    for (const groupSpec of tabSpec.groups) {
      const id = groupKeyToId.get(groupSpec.key);
      if (!id) continue;
      const containedIds: string[] = [];
      for (const k of groupSpec.nodeKeys) {
        const cid = nodeKeyToId.get(k) ?? junctionKeyToId.get(k) ?? commentKeyToId.get(k);
        if (cid !== undefined) {
          containedIds.push(cid);
        } else {
          diagnostics.push({
            severity: 'warning',
            rule: 'compile/unresolved-group-member',
            message: `Group '${groupSpec.key}' member '${k}' was dropped: no node/junction/comment with that key on this tab.`,
            tabId,
            nodeKey: groupSpec.key,
            context: { memberKey: k },
          });
        }
      }
      containedIds.sort();
      let parentId: string | undefined;
      if (groupSpec.parentKey !== undefined) {
        parentId = groupKeyToId.get(groupSpec.parentKey);
        if (parentId === undefined) {
          diagnostics.push({
            severity: 'warning',
            rule: 'compile/unresolved-group-parent',
            message: `Group '${groupSpec.key}' parentKey '${groupSpec.parentKey}' was dropped: no parent group with that key.`,
            tabId,
            nodeKey: groupSpec.key,
            context: { parentKey: groupSpec.parentKey },
          });
        }
      }
      flows.push(emitGroup(groupSpec, id, tabId, containedIds, parentId));
    }

    for (const commentSpec of tabSpec.comments) {
      const id = commentKeyToId.get(commentSpec.key);
      if (!id) continue;
      let groupId: string | undefined;
      if (commentSpec.groupKey !== undefined) {
        groupId = groupKeyToId.get(commentSpec.groupKey);
        if (groupId === undefined) {
          diagnostics.push({
            severity: 'warning',
            rule: 'compile/unresolved-group-ref',
            message: `Comment '${commentSpec.key}' groupKey '${commentSpec.groupKey}' was dropped: no group with that key on this tab.`,
            tabId,
            nodeKey: commentSpec.key,
            context: { groupKey: commentSpec.groupKey },
          });
        }
      }
      flows.push(emitComment(commentSpec, id, tabId, groupId));
    }
  }

  for (const configSpec of spec.configNodes ?? []) {
    const id = configKeyToId.get(configSpec.key);
    if (id === undefined) continue;
    flows.push(emitConfigNode(configSpec, id));
  }

  for (const defSpec of spec.subflowDefs ?? []) {
    const defId = subflowDefKeyToId.get(defSpec.id);
    if (defId === undefined) continue;
    const nodeKeyToId = new Map<string, string>();
    for (const n of defSpec.nodes) {
      nodeKeyToId.set(n.key, deriveId(prior, defId, 'node', n.key, strategy));
    }
    const junctionKeyToId = new Map<string, string>();
    for (const j of defSpec.junctions ?? []) {
      junctionKeyToId.set(j.key, deriveId(prior, defId, 'junction', j.key, strategy));
    }
    const wireTargetMap = new Map<string, string>([...nodeKeyToId, ...junctionKeyToId]);

    flows.push(emitSubflowDef(defSpec, defId));

    for (const nodeSpec of defSpec.nodes) {
      const id = nodeKeyToId.get(nodeSpec.key);
      if (!id) continue;
      const portCount = portCountForNode(nodeSpec, subflowDefOutCount);
      const wires = buildWiresForNode(
        nodeSpec.key,
        portCount,
        defSpec.connections,
        defId,
        diagnostics,
        wireTargetMap,
      );
      flows.push(
        emitNode(
          nodeSpec,
          id,
          defId,
          undefined,
          wires,
          configKeyToId,
          subflowDefKeyToId,
          diagnostics,
        ),
      );
    }
    for (const junctionSpec of defSpec.junctions ?? []) {
      const id = junctionKeyToId.get(junctionSpec.key);
      if (!id) continue;
      const wires = buildWiresForNode(
        junctionSpec.key,
        1,
        defSpec.connections,
        defId,
        diagnostics,
        wireTargetMap,
      );
      flows.push(emitJunction(junctionSpec, id, defId, undefined, wires));
    }
  }

  flows.sort(byCanonicalOrder);

  return {
    flows,
    hash: canonicalHash(flows),
    diagnostics,
  };
}
