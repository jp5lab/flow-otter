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
import { nodeDimensionsFor } from '../render/metrics.js';

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
  getInputPortCount,
  getOutputPortCount,
  isNodeLabelHidden,
} from './types.js';

export const AUTHORING_KEY_FIELD = '_authoringKey';

/**
 * Default group style matching the Node-RED editor's own new-group default.
 * A group with no `style` (or `style: null`) renders an INVISIBLE box in the
 * editor — verified live against Node-RED 4.1/5.0: only a style with a real
 * `stroke` draws a border (eval campaign 2026-06-10). FlowOtter therefore
 * emits this default when the agent supplies none, so authored groups are
 * actually visible. decompile() strips it back to `undefined` so the
 * round-trip stays idempotent.
 */
export const DEFAULT_GROUP_STYLE: Readonly<Record<string, unknown>> = Object.freeze({
  stroke: '#a4a4a4',
  'stroke-opacity': '1',
  fill: 'none',
  'fill-opacity': '1',
  label: true,
  'label-position': 'nw',
  color: '#a4a4a4',
});

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
type BaselineScope = 'global' | 'tab' | 'subflow' | 'unknown';

const AMBIGUOUS = Symbol('ambiguous');
type ByKindKeyVal = string | typeof AMBIGUOUS;

interface PriorIndex {
  /** `${tabId}:${kind}:${authoringKey}` → existing Node-RED id (exact match). */
  byTabKindKey: Map<string, string>;
  /**
   * `${scope}:${kind}:${authoringKey}` → existing id, OR `AMBIGUOUS` if
   * multiple prior nodes share the same scope+kind+key. The cross-container
   * move fallback uses this when the exact container+kind+key lookup misses.
   * Tab-canvas children and subflow-body children are separate scopes so equal
   * keys in one scope cannot steal baseline ids from the other.
   */
  byScopeKindKey: Map<string, ByKindKeyVal>;
  /**
   * Every prior id, used as a legacy fallback when prior was authored
   * without `_authoringKey` (e.g. straight from the Node-RED editor).
   */
  allIds: Set<string>;
  /**
   * Ids already claimed by ID resolution during this compile pass. Prevents two
   * new spec entries from claiming the same prior id when the scoped fallback
   * would otherwise hand it out twice.
   */
  reservedIds: Set<string>;
}

type IdContainerRef =
  | { readonly kind: 'global' }
  | { readonly kind: 'tab'; readonly spec: TabSpec }
  | { readonly kind: 'subflow'; readonly spec: SubflowDefSpec };

interface IdEntry {
  readonly container: IdContainerRef;
  readonly kind: Kind;
  readonly key: string;
  readonly fallbackScope: BaselineScope;
  readonly assign: (id: string) => void;
  id?: string;
}

interface TabResolvedIds {
  readonly nodeKeyToId: Map<string, string>;
  readonly junctionKeyToId: Map<string, string>;
  readonly groupKeyToId: Map<string, string>;
  readonly commentKeyToId: Map<string, string>;
}

interface SubflowResolvedIds {
  readonly nodeKeyToId: Map<string, string>;
  readonly junctionKeyToId: Map<string, string>;
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

function baselineScopeForPrior(
  kind: Kind,
  containerId: string,
  tabIds: ReadonlySet<string>,
  subflowDefIds: ReadonlySet<string>,
): BaselineScope {
  if (kind === 'tab' || kind === 'subflowDef' || kind === 'config') return 'global';
  if (tabIds.has(containerId)) return 'tab';
  if (subflowDefIds.has(containerId)) return 'subflow';
  return 'unknown';
}

function addScopedPriorId(
  idx: PriorIndex,
  scope: BaselineScope,
  kind: Kind,
  key: string,
  id: string,
): void {
  const kk = `${scope}:${kind}:${key}`;
  const prev = idx.byScopeKindKey.get(kk);
  if (prev === undefined) {
    idx.byScopeKindKey.set(kk, id);
  } else if (prev !== id && prev !== AMBIGUOUS) {
    idx.byScopeKindKey.set(kk, AMBIGUOUS);
  }
}

function buildPriorIndex(prior: FlowsJson | undefined): PriorIndex {
  const idx: PriorIndex = {
    byTabKindKey: new Map(),
    byScopeKindKey: new Map(),
    allIds: new Set(),
    reservedIds: new Set(),
  };
  if (!prior) return idx;
  const tabIds = new Set<string>();
  const subflowDefIds = new Set<string>();
  for (const node of prior) {
    if (node.type === 'tab') tabIds.add(node.id);
    if (node.type === 'subflow') subflowDefIds.add(node.id);
  }
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
    addScopedPriorId(
      idx,
      baselineScopeForPrior(kind, containerId, tabIds, subflowDefIds),
      kind,
      ext,
      node.id,
    );
  }
  return idx;
}

function reserve(prior: PriorIndex, id: string): string {
  prior.reservedIds.add(id);
  return id;
}

function priorGlobalId(prior: PriorIndex, kind: Kind, key: string): string | undefined {
  const id = prior.byScopeKindKey.get(`global:${kind}:${key}`);
  return typeof id === 'string' ? id : undefined;
}

function priorContainerIdForExact(prior: PriorIndex, entry: IdEntry): string | undefined {
  switch (entry.container.kind) {
    case 'global':
      return priorGlobalId(prior, entry.kind, entry.key);
    case 'tab':
      return priorGlobalId(prior, 'tab', entry.container.spec.id);
    case 'subflow':
      return priorGlobalId(prior, 'subflowDef', entry.container.spec.id);
  }
}

function reserveExactId(prior: PriorIndex, entry: IdEntry): void {
  const containerId = priorContainerIdForExact(prior, entry);
  if (containerId === undefined) return;
  const exact = prior.byTabKindKey.get(`${containerId}:${entry.kind}:${entry.key}`);
  if (exact === undefined || prior.reservedIds.has(exact)) return;
  entry.id = reserve(prior, exact);
  entry.assign(entry.id);
}

function freshId(prior: PriorIndex, seed: string): string {
  const unsalted = generateNodeId(seed);
  if (!prior.reservedIds.has(unsalted) && !prior.allIds.has(unsalted)) {
    return reserve(prior, unsalted);
  }
  let n = 1;
  while (true) {
    const salted = generateNodeId(`${seed}~${n}`);
    if (!prior.reservedIds.has(salted) && !prior.allIds.has(salted)) {
      return reserve(prior, salted);
    }
    n++;
  }
}

function seedForId(containerId: string, kind: Kind, key: string): string {
  return kind === 'tab' || kind === 'subflowDef' || kind === 'config'
    ? `${kind}:${key}`
    : `${containerId}:${kind}:${key}`;
}

function resolveIdEntry(
  prior: PriorIndex,
  entry: IdEntry,
  containerId: string,
  strategy: 'hash' | 'fixed',
): void {
  if (entry.id !== undefined) return;
  const kk = prior.byScopeKindKey.get(`${entry.fallbackScope}:${entry.kind}:${entry.key}`);
  if (typeof kk === 'string' && !prior.reservedIds.has(kk)) {
    entry.id = reserve(prior, kk);
    entry.assign(entry.id);
    return;
  }
  if (prior.allIds.has(entry.key) && !prior.reservedIds.has(entry.key)) {
    entry.id = reserve(prior, entry.key);
    entry.assign(entry.id);
    return;
  }
  if (strategy === 'fixed') {
    entry.id = reserve(prior, entry.key);
    entry.assign(entry.id);
    return;
  }
  entry.id = freshId(prior, seedForId(containerId, entry.kind, entry.key));
  entry.assign(entry.id);
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
  autoFit: { x: number; y: number; w: number; h: number } | undefined,
): GroupNode {
  const geometry =
    spec.position !== undefined || spec.size !== undefined
      ? {
          ...(spec.position !== undefined ? { x: spec.position.x, y: spec.position.y } : {}),
          ...(spec.size !== undefined ? { w: spec.size.w, h: spec.size.h } : {}),
        }
      : autoFit !== undefined
        ? { x: autoFit.x, y: autoFit.y, w: autoFit.w, h: autoFit.h }
        : {};
  return {
    ...(spec.passthrough ?? {}),
    id,
    type: 'group',
    z: tabId,
    name: spec.name,
    nodes: containedIds,
    ...geometry,
    ...(parentId !== undefined ? { g: parentId } : {}),
    ...(spec.info !== undefined ? { info: spec.info } : {}),
    style: spec.style ?? DEFAULT_GROUP_STYLE,
    [AUTHORING_KEY_FIELD]: spec.key,
  };
}

const GROUP_FIT_PAD_X = 20;
const GROUP_FIT_PAD_TOP = 40; // headroom for the group name bar
const GROUP_FIT_PAD_BOTTOM = 20;
const JUNCTION_SIZE = 10;
const GRID = 20;

/**
 * Compute a bounding box for a group from its direct members' positions.
 * Node-RED does NOT auto-fit a dimension-less group on import — the runtime
 * stores x/y/w/h as null and the editor renders nothing (verified live
 * against 4.1.11; eval campaign 2026-06-10). So groups authored without
 * explicit geometry get a deterministic, grid-snapped fit here instead.
 *
 * Member dimensions are editor-true (REND-2): widths/heights come from
 * `nodeDimensionsFor` (the pinned 4.1 GeometryProvider profile — permanent
 * regardless of target runtime, keeping compile() pure), with per-node
 * input/output counts and label-hidden link pills honored. Comments without
 * an explicit size measure like the editor does (label-derived width, 30px
 * tall).
 *
 * Members are matched by groupKey/nodeKeys over nodes, junctions, and
 * comments. Child groups (nested via parentKey) are not folded into the
 * fit — a parent group containing only child groups keeps legacy omit
 * behavior. Returns undefined when no member has a usable position.
 */
function autoFitGroupGeometry(
  tabSpec: TabSpec,
  groupSpec: GroupSpec,
  subflowDefOutCount: ReadonlyMap<string, number>,
): { x: number; y: number; w: number; h: number } | undefined {
  const member = new Set(groupSpec.nodeKeys);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  const include = (cx: number, cy: number, w: number, h: number): void => {
    minX = Math.min(minX, cx - w / 2);
    maxX = Math.max(maxX, cx + w / 2);
    minY = Math.min(minY, cy - h / 2);
    maxY = Math.max(maxY, cy + h / 2);
    found = true;
  };
  for (const n of tabSpec.nodes) {
    if (!member.has(n.key)) continue;
    const { w, h } = nodeDimensionsFor(n.label ?? n.type, {
      inputs: getInputPortCount(n.type, n.passthrough),
      outputs: portCountForNode(n, subflowDefOutCount),
      hideLabel: isNodeLabelHidden(n.type, n.passthrough),
    });
    include(n.position.x, n.position.y, w, h);
  }
  for (const j of tabSpec.junctions ?? []) {
    if (!member.has(j.key)) continue;
    include(j.position.x, j.position.y, JUNCTION_SIZE, JUNCTION_SIZE);
  }
  for (const c of tabSpec.comments) {
    if (!member.has(c.key)) continue;
    const { w, h } = c.size ?? nodeDimensionsFor(c.text, { inputs: 0, outputs: 0 });
    include(c.position.x, c.position.y, w, h);
  }
  if (!found) return undefined;
  const x = Math.floor((minX - GROUP_FIT_PAD_X) / GRID) * GRID;
  const y = Math.floor((minY - GROUP_FIT_PAD_TOP) / GRID) * GRID;
  const w = Math.ceil((maxX + GROUP_FIT_PAD_X - x) / GRID) * GRID;
  const h = Math.ceil((maxY + GROUP_FIT_PAD_BOTTOM - y) / GRID) * GRID;
  return { x, y, w, h };
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
  const configKeyToId = new Map<string, string>();
  const subflowDefKeyToId = new Map<string, string>();
  const subflowDefIdBySpec = new Map<SubflowDefSpec, string>();
  const tabIdBySpec = new Map<TabSpec, string>();
  const idsByTab = new Map<TabSpec, TabResolvedIds>();
  const idsBySubflowDef = new Map<SubflowDefSpec, SubflowResolvedIds>();
  const idEntries: IdEntry[] = [];

  const addIdEntry = (entry: IdEntry): void => {
    idEntries.push(entry);
  };

  for (const configSpec of spec.configNodes ?? []) {
    addIdEntry({
      container: { kind: 'global' },
      kind: 'config',
      key: configSpec.key,
      fallbackScope: 'global',
      assign: (id) => configKeyToId.set(configSpec.key, id),
    });
  }

  for (const defSpec of spec.subflowDefs ?? []) {
    addIdEntry({
      container: { kind: 'global' },
      kind: 'subflowDef',
      key: defSpec.id,
      fallbackScope: 'global',
      assign: (id) => {
        subflowDefKeyToId.set(defSpec.id, id);
        subflowDefIdBySpec.set(defSpec, id);
      },
    });
  }

  for (const tabSpec of spec.tabs) {
    const tabIds: TabResolvedIds = {
      nodeKeyToId: new Map(),
      junctionKeyToId: new Map(),
      groupKeyToId: new Map(),
      commentKeyToId: new Map(),
    };
    idsByTab.set(tabSpec, tabIds);

    addIdEntry({
      container: { kind: 'global' },
      kind: 'tab',
      key: tabSpec.id,
      fallbackScope: 'global',
      assign: (id) => tabIdBySpec.set(tabSpec, id),
    });

    for (const n of tabSpec.nodes) {
      addIdEntry({
        container: { kind: 'tab', spec: tabSpec },
        kind: 'node',
        key: n.key,
        fallbackScope: 'tab',
        assign: (id) => tabIds.nodeKeyToId.set(n.key, id),
      });
    }
    for (const j of tabSpec.junctions ?? []) {
      addIdEntry({
        container: { kind: 'tab', spec: tabSpec },
        kind: 'junction',
        key: j.key,
        fallbackScope: 'tab',
        assign: (id) => tabIds.junctionKeyToId.set(j.key, id),
      });
    }
    for (const g of tabSpec.groups) {
      addIdEntry({
        container: { kind: 'tab', spec: tabSpec },
        kind: 'group',
        key: g.key,
        fallbackScope: 'tab',
        assign: (id) => tabIds.groupKeyToId.set(g.key, id),
      });
    }
    for (const c of tabSpec.comments) {
      addIdEntry({
        container: { kind: 'tab', spec: tabSpec },
        kind: 'comment',
        key: c.key,
        fallbackScope: 'tab',
        assign: (id) => tabIds.commentKeyToId.set(c.key, id),
      });
    }
  }

  for (const defSpec of spec.subflowDefs ?? []) {
    const bodyIds: SubflowResolvedIds = {
      nodeKeyToId: new Map(),
      junctionKeyToId: new Map(),
    };
    idsBySubflowDef.set(defSpec, bodyIds);

    for (const n of defSpec.nodes) {
      addIdEntry({
        container: { kind: 'subflow', spec: defSpec },
        kind: 'node',
        key: n.key,
        fallbackScope: 'subflow',
        assign: (id) => bodyIds.nodeKeyToId.set(n.key, id),
      });
    }
    for (const j of defSpec.junctions ?? []) {
      addIdEntry({
        container: { kind: 'subflow', spec: defSpec },
        kind: 'junction',
        key: j.key,
        fallbackScope: 'subflow',
        assign: (id) => bodyIds.junctionKeyToId.set(j.key, id),
      });
    }
  }

  for (const entry of idEntries) reserveExactId(prior, entry);

  for (const entry of idEntries) {
    let containerId = '';
    if (entry.container.kind === 'tab') {
      const tabId = tabIdBySpec.get(entry.container.spec);
      if (tabId === undefined) throw new Error(`Internal compile error: unresolved tab id.`);
      containerId = tabId;
    } else if (entry.container.kind === 'subflow') {
      const defId = subflowDefIdBySpec.get(entry.container.spec);
      if (defId === undefined) throw new Error(`Internal compile error: unresolved subflow id.`);
      containerId = defId;
    }
    resolveIdEntry(prior, entry, containerId, strategy);
  }

  for (const tabSpec of spec.tabs) {
    const tabId = tabIdBySpec.get(tabSpec);
    const resolved = idsByTab.get(tabSpec);
    if (tabId === undefined || resolved === undefined) continue;
    const { nodeKeyToId, junctionKeyToId, groupKeyToId, commentKeyToId } = resolved;

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
      const autoFit =
        groupSpec.position === undefined && groupSpec.size === undefined
          ? autoFitGroupGeometry(tabSpec, groupSpec, subflowDefOutCount)
          : undefined;
      flows.push(emitGroup(groupSpec, id, tabId, containedIds, parentId, autoFit));
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
    const defId = subflowDefIdBySpec.get(defSpec);
    const resolved = idsBySubflowDef.get(defSpec);
    if (defId === undefined || resolved === undefined) continue;
    const { nodeKeyToId, junctionKeyToId } = resolved;
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
