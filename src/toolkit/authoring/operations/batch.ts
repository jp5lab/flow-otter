import {
  isComment,
  isGroup,
  isJunction,
  isRegularNode,
  isTab,
  type FlowsJson,
  type FlowsJsonNode,
} from '../../../shared/flows-json.js';
import { getNodeSchema } from '../node-schemas.js';
import type { CompileIdTombstone } from '../compile.js';
import {
  getOutputPortCount,
  type AuthoringSpec,
  type ConnectionSpec,
  type NodeSpec,
  type Position,
  type TabSpec,
} from '../types.js';

import { findCanvasObject } from './_membership.js';
import { applyPatches, PatchError, type Patch } from './_patches.js';
import { addComment } from './add-comment.js';
import { addGroup } from './add-group.js';
import { addJunction } from './add-junction.js';
import { addNode } from './add-node.js';
import { removeComment } from './remove-comment.js';
import { removeGroup } from './remove-group.js';
import { removeNode } from './remove-node.js';
import { setLinks } from './set-links.js';
import { updateComment } from './update-comment.js';
import { updateGroup } from './update-group.js';
import { updateNode } from './update-node.js';
import { moveNode } from './move-node.js';

export type BatchOp =
  | AddNodeOp
  | AddJunctionOp
  | AddGroupOp
  | AddCommentOp
  | WireNodesOp
  | SetWiresOp
  | SetLinksOp
  | RemoveNodeOp
  | RemoveCommentOp
  | UpdateNodeOp
  | MoveNodeOp
  | UpdateGroupOp
  | RemoveGroupOp
  | UpdateCommentOp;

export interface AddNodeOp {
  readonly op: 'add_node';
  readonly tab_id: string;
  readonly type: string;
  readonly opts?: {
    readonly key?: string;
    readonly label?: string;
    readonly position?: Position;
    readonly group_key?: string;
    readonly passthrough?: Record<string, unknown>;
    readonly source_node_id?: string;
    readonly source_output_port?: number;
  };
}

export interface AddJunctionOp {
  readonly op: 'add_junction';
  readonly tab_id: string;
  readonly key?: string;
  readonly position?: Position;
  readonly name?: string;
  readonly group_key?: string;
  readonly disabled?: boolean;
}

export interface AddGroupOp {
  readonly op: 'add_group';
  readonly tab_id: string;
  readonly key?: string;
  readonly name: string;
  readonly node_keys?: readonly string[];
  readonly position?: Position;
  readonly size?: { readonly w: number; readonly h: number };
  readonly parent_key?: string;
  readonly info?: string;
  readonly style?: Readonly<Record<string, unknown>>;
}

export interface AddCommentOp {
  readonly op: 'add_comment';
  readonly tab_id: string;
  readonly key?: string;
  readonly text: string;
  readonly position?: Position;
  readonly info?: string;
  readonly group_key?: string;
}

export interface WireNodesOp {
  readonly op: 'wire_nodes';
  readonly tab_id: string;
  readonly from_key: string;
  readonly to_key: string;
  readonly output_port?: number;
}

export interface SetWiresOp {
  readonly op: 'set_wires';
  readonly tab_id: string;
  readonly source_node_id: string;
  readonly output_port?: number;
  readonly target_node_ids: readonly string[];
}

export interface SetLinksOp {
  readonly op: 'set_links';
  readonly source_node_id: string;
  readonly target_node_ids: readonly string[];
}

export interface RemoveNodeOp {
  readonly op: 'remove_node';
  readonly tab_id: string;
  readonly node_id: string;
}

export interface RemoveCommentOp {
  readonly op: 'remove_comment';
  readonly tab_id: string;
  readonly comment_key: string;
}

export interface UpdateNodeOp {
  readonly op: 'update_node';
  readonly tab_id: string;
  readonly node_id: string;
  readonly label?: string;
  readonly position?: Position;
  readonly group_key?: string | null;
  readonly disabled?: boolean;
  readonly passthrough?: Readonly<Record<string, unknown>>;
  readonly patches?: readonly Patch[];
}

export interface MoveNodeOp {
  readonly op: 'move_node';
  readonly tab_id: string;
  readonly node_id: string;
  readonly dest_tab_id?: string;
  readonly position?: Position;
}

export interface UpdateGroupOp {
  readonly op: 'update_group';
  readonly tab_id: string;
  readonly group_key: string;
  readonly name?: string;
  readonly node_keys?: readonly string[];
  readonly position?: Position;
  readonly size?: { readonly w: number; readonly h: number };
  readonly parent_key?: string | null;
  readonly info?: string | null;
  readonly style?: Readonly<Record<string, unknown>> | null;
  readonly passthrough?: Readonly<Record<string, unknown>>;
  readonly refit?: boolean;
}

export interface RemoveGroupOp {
  readonly op: 'remove_group';
  readonly tab_id: string;
  readonly group_key: string;
}

export interface UpdateCommentOp {
  readonly op: 'update_comment';
  readonly tab_id: string;
  readonly comment_key: string;
  readonly text?: string;
  readonly position?: Position;
  readonly size?: { readonly w: number; readonly h: number } | null;
  readonly info?: string | null;
  readonly group_key?: string | null;
}

export type BatchOpResult = Readonly<Record<string, unknown>> & {
  readonly index: number;
  readonly op: BatchOp['op'];
  readonly ok: true;
};

export interface ApplyOpsResult {
  readonly spec: AuthoringSpec;
  readonly opResults: readonly BatchOpResult[];
  readonly idTombstones: readonly CompileIdTombstone[];
}

export class ApplyOpError extends Error {
  constructor(
    public readonly failedOpIndex: number,
    public readonly failedOp: BatchOp,
    public override readonly cause: unknown,
  ) {
    super(`Operation ${failedOpIndex} (${failedOp.op}) failed: ${causeMessage(cause)}`);
    this.name = 'ApplyOpError';
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function applyOps(
  priorSpec: AuthoringSpec,
  priorFlows: FlowsJson,
  ops: readonly BatchOp[],
): ApplyOpsResult {
  let spec = priorSpec;
  const opResults: BatchOpResult[] = [];
  const idTombstones: CompileIdTombstone[] = [];

  for (const [index, op] of ops.entries()) {
    try {
      const applied = applyOne(spec, priorFlows, op, idTombstones, index);
      spec = applied.spec;
      opResults.push(applied.result);
    } catch (err) {
      throw new ApplyOpError(index, op, err);
    }
  }

  return { spec, opResults, idTombstones };
}

function applyOne(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  op: BatchOp,
  idTombstones: CompileIdTombstone[],
  index: number,
): { readonly spec: AuthoringSpec; readonly result: BatchOpResult } {
  switch (op.op) {
    case 'add_node': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const opts: Parameters<typeof addNode>[3] = {};
      if (op.opts?.key !== undefined) opts.key = op.opts.key;
      if (op.opts?.label !== undefined) opts.label = op.opts.label;
      if (op.opts?.position !== undefined) opts.position = op.opts.position;
      if (op.opts?.group_key !== undefined) {
        opts.groupKey = resolveGroupKeyOnTab(spec, priorFlows, tabId, op.opts.group_key);
      }
      const validatedPassthrough = materializeNodePassthrough(op.type, op.opts?.passthrough);
      if (validatedPassthrough !== undefined) opts.passthrough = validatedPassthrough;
      if (op.opts?.source_node_id !== undefined) {
        opts.sourceNodeKey = resolveRegularNodeKeyOnTab(
          spec,
          priorFlows,
          tabId,
          op.opts.source_node_id,
        );
      }
      if (op.opts?.source_output_port !== undefined) {
        opts.sourceOutputPort = op.opts.source_output_port;
      }
      const { spec: nextSpec, newNodeKey, wired } = addNode(spec, tabId, op.type, opts);
      return {
        spec: nextSpec,
        result: { index, op: op.op, ok: true, tab_id: tabId, added_node_key: newNodeKey, wired },
      };
    }
    case 'add_junction': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const opts: Parameters<typeof addJunction>[2] = {};
      if (op.key !== undefined) opts.key = op.key;
      if (op.position !== undefined) opts.position = op.position;
      if (op.name !== undefined) opts.name = op.name;
      if (op.group_key !== undefined) {
        opts.groupKey = resolveGroupKeyOnTab(spec, priorFlows, tabId, op.group_key);
      }
      if (op.disabled !== undefined) opts.disabled = op.disabled;
      const { spec: nextSpec, newJunctionKey } = addJunction(spec, tabId, opts);
      return {
        spec: nextSpec,
        result: {
          index,
          op: op.op,
          ok: true,
          tab_id: tabId,
          added_junction_key: newJunctionKey,
        },
      };
    }
    case 'add_group': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const opts: Parameters<typeof addGroup>[2] = { name: op.name };
      if (op.key !== undefined) opts.key = op.key;
      if (op.node_keys !== undefined) {
        opts.nodeKeys = op.node_keys.map((k) =>
          resolveCanvasObjectKeyOnTab(spec, priorFlows, tabId, k),
        );
      }
      if (op.position !== undefined) opts.position = op.position;
      if (op.size !== undefined) opts.size = op.size;
      if (op.parent_key !== undefined) {
        opts.parentKey = resolveGroupKeyOnTab(spec, priorFlows, tabId, op.parent_key);
      }
      if (op.info !== undefined) opts.info = op.info;
      if (op.style !== undefined) opts.style = op.style;
      const { spec: nextSpec, newGroupKey } = addGroup(spec, tabId, opts);
      return {
        spec: nextSpec,
        result: { index, op: op.op, ok: true, tab_id: tabId, added_group_key: newGroupKey },
      };
    }
    case 'add_comment': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const opts: Parameters<typeof addComment>[2] = { text: op.text };
      if (op.key !== undefined) opts.key = op.key;
      if (op.position !== undefined) opts.position = op.position;
      if (op.info !== undefined) opts.info = op.info;
      if (op.group_key !== undefined) {
        opts.groupKey = resolveGroupKeyOnTab(spec, priorFlows, tabId, op.group_key);
      }
      const { spec: nextSpec, newCommentKey } = addComment(spec, tabId, opts);
      return {
        spec: nextSpec,
        result: { index, op: op.op, ok: true, tab_id: tabId, added_comment_key: newCommentKey },
      };
    }
    case 'wire_nodes': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const fromKey = resolveWireParticipantKeyOnTab(spec, priorFlows, tabId, op.from_key);
      const toKey = resolveWireParticipantKeyOnTab(spec, priorFlows, tabId, op.to_key);
      const { spec: nextSpec, added } = wireParticipants(spec, tabId, fromKey, toKey, {
        outputPort: op.output_port ?? 0,
      });
      return {
        spec: nextSpec,
        result: { index, op: op.op, ok: true, tab_id: tabId, wire_added: added },
      };
    }
    case 'set_wires': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const sourceKey = resolveWireParticipantKeyOnTab(spec, priorFlows, tabId, op.source_node_id);
      const targetKeys = op.target_node_ids.map((k) =>
        resolveWireParticipantKeyOnTab(spec, priorFlows, tabId, k),
      );
      const {
        spec: nextSpec,
        removed,
        added,
      } = setParticipantWires(spec, {
        tabId,
        sourceKey,
        outputPort: op.output_port ?? 0,
        targetKeys,
      });
      return {
        spec: nextSpec,
        result: {
          index,
          op: op.op,
          ok: true,
          tab_id: tabId,
          wires_removed_count: removed,
          wires_added_count: added,
        },
      };
    }
    case 'set_links': {
      const sourceKey = resolveNodeKeyAnywhere(spec, priorFlows, op.source_node_id);
      const targetKeys = op.target_node_ids.map((k) => resolveNodeKeyAnywhere(spec, priorFlows, k));
      const { spec: nextSpec, paired } = setLinks(spec, { sourceKey, targetKeys, priorFlows });
      return { spec: nextSpec, result: { index, op: op.op, ok: true, paired_count: paired } };
    }
    case 'remove_node': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const target = resolveCanvasObjectOnTab(spec, priorFlows, tabId, op.node_id);
      const { spec: nextSpec, removed } = removeNode(spec, tabId, target.key);
      idTombstones.push({ tabId, kind: target.kind, key: target.key });
      return {
        spec: nextSpec,
        result: { index, op: op.op, ok: true, tab_id: tabId, removed, removed_key: target.key },
      };
    }
    case 'remove_comment': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const target = resolveCanvasObjectOnTab(spec, priorFlows, tabId, op.comment_key);
      if (target.kind !== 'comment') {
        throw new Error(`Comment '${op.comment_key}' resolved to a ${target.kind}.`);
      }
      const { spec: nextSpec, removed } = removeComment(spec, tabId, target.key);
      idTombstones.push({ tabId, kind: 'comment', key: target.key });
      return {
        spec: nextSpec,
        result: { index, op: op.op, ok: true, tab_id: tabId, removed, removed_key: target.key },
      };
    }
    case 'update_node': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const target = resolveCanvasObjectOnTab(spec, priorFlows, tabId, op.node_id);
      const opts = buildUpdateNodeOpts(target, op);
      const { spec: nextSpec, updated } = updateNode(spec, tabId, target.key, opts);
      return {
        spec: nextSpec,
        result: {
          index,
          op: op.op,
          ok: true,
          tab_id: tabId,
          updated,
          updated_key: target.key,
          patches_applied: op.patches?.length ?? 0,
        },
      };
    }
    case 'move_node': {
      const sourceTabId = resolveTabId(spec, priorFlows, op.tab_id);
      const target = resolveCanvasObjectOnTab(spec, priorFlows, sourceTabId, op.node_id);
      const opts: Parameters<typeof moveNode>[3] = {};
      const destTabId =
        op.dest_tab_id !== undefined ? resolveTabId(spec, priorFlows, op.dest_tab_id) : sourceTabId;
      if (op.dest_tab_id !== undefined) opts.destTabId = destTabId;
      if (op.position !== undefined) opts.position = op.position;
      const { spec: nextSpec } = moveNode(spec, sourceTabId, target.key, opts);
      return {
        spec: nextSpec,
        result: {
          index,
          op: op.op,
          ok: true,
          source_tab_id: sourceTabId,
          dest_tab_id: destTabId,
          moved_node_key: target.key,
        },
      };
    }
    case 'update_group': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const groupKey = resolveGroupKeyOnTab(spec, priorFlows, tabId, op.group_key);
      const opts: Parameters<typeof updateGroup>[3] = {};
      if (op.name !== undefined) opts.name = op.name;
      if (op.node_keys !== undefined) {
        opts.nodeKeys = op.node_keys.map((k) =>
          resolveCanvasObjectKeyOnTab(spec, priorFlows, tabId, k),
        );
      }
      if (op.position !== undefined) opts.position = op.position;
      if (op.size !== undefined) opts.size = op.size;
      if (op.parent_key !== undefined) {
        opts.parentKey =
          op.parent_key === null
            ? null
            : resolveGroupKeyOnTab(spec, priorFlows, tabId, op.parent_key);
      }
      if (op.info !== undefined) opts.info = op.info;
      if (op.style !== undefined) opts.style = op.style;
      if (op.passthrough !== undefined) opts.passthrough = op.passthrough;
      if (op.refit !== undefined) opts.refit = op.refit;
      const { spec: nextSpec, updated } = updateGroup(spec, tabId, groupKey, opts);
      return {
        spec: nextSpec,
        result: { index, op: op.op, ok: true, tab_id: tabId, updated, updated_group_key: groupKey },
      };
    }
    case 'remove_group': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const groupKey = resolveGroupKeyOnTab(spec, priorFlows, tabId, op.group_key);
      const { spec: nextSpec, removed } = removeGroup(spec, tabId, groupKey);
      idTombstones.push({ tabId, kind: 'group', key: groupKey });
      return {
        spec: nextSpec,
        result: { index, op: op.op, ok: true, tab_id: tabId, removed, removed_group_key: groupKey },
      };
    }
    case 'update_comment': {
      const tabId = resolveTabId(spec, priorFlows, op.tab_id);
      const target = resolveCanvasObjectOnTab(spec, priorFlows, tabId, op.comment_key);
      if (target.kind !== 'comment') {
        throw new Error(`Comment '${op.comment_key}' resolved to a ${target.kind}.`);
      }
      const opts: Parameters<typeof updateComment>[3] = {};
      if (op.text !== undefined) opts.text = op.text;
      if (op.position !== undefined) opts.position = op.position;
      if (op.size !== undefined) opts.size = op.size;
      if (op.info !== undefined) opts.info = op.info;
      if (op.group_key !== undefined) {
        opts.groupKey =
          op.group_key === null
            ? null
            : resolveGroupKeyOnTab(spec, priorFlows, tabId, op.group_key);
      }
      const { spec: nextSpec, updated } = updateComment(spec, tabId, target.key, opts);
      return {
        spec: nextSpec,
        result: {
          index,
          op: op.op,
          ok: true,
          tab_id: tabId,
          updated,
          updated_comment_key: target.key,
        },
      };
    }
  }
}

function materializeNodePassthrough(
  type: string,
  passthrough: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const schema = getNodeSchema(type);
  if (schema === undefined) return passthrough;
  if (passthrough !== undefined) {
    const parsed = schema.safeParse(passthrough);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`passthrough for type '${type}' failed schema validation: ${issues}`);
    }
    return parsed.data as Record<string, unknown>;
  }
  const empty = schema.safeParse({});
  return empty.success ? (empty.data as Record<string, unknown>) : undefined;
}

function buildUpdateNodeOpts(
  target: {
    readonly key: string;
    readonly kind: 'node' | 'junction' | 'comment';
    readonly object: unknown;
  },
  op: UpdateNodeOp,
): Parameters<typeof updateNode>[3] {
  const opts: Parameters<typeof updateNode>[3] = {};
  if (op.label !== undefined) opts.label = op.label;
  if (op.position !== undefined) opts.position = op.position;
  if (op.group_key !== undefined) opts.groupKey = op.group_key;
  if (op.disabled !== undefined) opts.disabled = op.disabled;

  let effectivePassthrough = op.passthrough;
  if (op.patches !== undefined && op.patches.length > 0) {
    if (target.kind !== 'node') {
      throw new Error(
        `patches are only supported for regular nodes; '${op.node_id}' resolved to a ${target.kind}.`,
      );
    }
    const object = target.object as NodeSpec;
    const merged: Record<string, unknown> = {
      ...(object.passthrough ?? {}),
      ...(op.passthrough ?? {}),
    };
    const byProperty = new Map<string, Patch[]>();
    for (const patch of op.patches) {
      const existing = byProperty.get(patch.property) ?? [];
      existing.push(patch);
      byProperty.set(patch.property, existing);
    }
    for (const [property, patches] of byProperty) {
      const current = merged[property];
      const baseline = typeof current === 'string' ? current : '';
      try {
        merged[property] = applyPatches(baseline, patches);
      } catch (err) {
        if (err instanceof PatchError) {
          throw new Error(`patches on property '${property}': ${err.message}`);
        }
        throw err;
      }
    }
    effectivePassthrough = merged;
  }
  if (effectivePassthrough !== undefined) opts.passthrough = effectivePassthrough;
  return opts;
}

function resolveTabId(spec: AuthoringSpec, priorFlows: FlowsJson, value: string): string {
  if (spec.tabs.some((t) => t.id === value)) return value;
  const priorTab = priorFlows.find(
    (n) => isTab(n) && (n.id === value || authoringKey(n) === value),
  );
  if (priorTab !== undefined) {
    const key = authoringKey(priorTab);
    if (spec.tabs.some((t) => t.id === key)) return key;
  }
  throw new Error(`Tab '${value}' not found in current flows.`);
}

function tabById(spec: AuthoringSpec, tabId: string): TabSpec {
  const tab = spec.tabs.find((t) => t.id === tabId);
  if (tab === undefined) throw new Error(`Tab '${tabId}' not found in spec.`);
  return tab;
}

function resolveRegularNodeKeyOnTab(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  tabId: string,
  value: string,
): string {
  const tab = tabById(spec, tabId);
  if (tab.nodes.some((n) => n.key === value)) return value;
  const match = findPriorCanvasMatch(priorFlows, value);
  if (match !== undefined && match.kind === 'node' && match.tabId === tabId) {
    if (tab.nodes.some((n) => n.key === match.key)) return match.key;
  }
  throw new Error(`Node '${value}' not found on tab '${tabId}'.`);
}

function resolveWireParticipantKeyOnTab(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  tabId: string,
  value: string,
): string {
  const tab = tabById(spec, tabId);
  if (
    tab.nodes.some((n) => n.key === value) ||
    (tab.junctions ?? []).some((j) => j.key === value)
  ) {
    return value;
  }
  const match = findPriorCanvasMatch(priorFlows, value);
  if (
    match !== undefined &&
    (match.kind === 'node' || match.kind === 'junction') &&
    match.tabId === tabId
  ) {
    if (
      tab.nodes.some((n) => n.key === match.key) ||
      (tab.junctions ?? []).some((j) => j.key === match.key)
    ) {
      return match.key;
    }
  }
  throw new Error(`Node or junction '${value}' not found on tab '${tabId}'.`);
}

function resolveCanvasObjectKeyOnTab(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  tabId: string,
  value: string,
): string {
  return resolveCanvasObjectOnTab(spec, priorFlows, tabId, value).key;
}

function resolveCanvasObjectOnTab(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  tabId: string,
  value: string,
): {
  readonly key: string;
  readonly kind: 'node' | 'junction' | 'comment';
  readonly object:
    | NodeSpec
    | NonNullable<TabSpec['junctions']>[number]
    | TabSpec['comments'][number];
} {
  const tab = tabById(spec, tabId);
  const direct = findCanvasObject(tab, value);
  if (direct !== undefined) return { key: value, kind: direct.kind, object: direct.value };
  const match = findPriorCanvasMatch(priorFlows, value);
  if (match !== undefined && match.tabId === tabId) {
    const object = findCanvasObject(tab, match.key);
    if (object !== undefined && object.kind === match.kind) {
      return { key: match.key, kind: object.kind, object: object.value };
    }
  }
  throw new Error(`Node, junction, or comment '${value}' not found on tab '${tabId}'.`);
}

function resolveGroupKeyOnTab(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  tabId: string,
  value: string,
): string {
  const tab = tabById(spec, tabId);
  if (tab.groups.some((g) => g.key === value)) return value;
  const match = findPriorGroupMatch(priorFlows, value);
  if (match !== undefined && match.tabId === tabId && tab.groups.some((g) => g.key === match.key)) {
    return match.key;
  }
  throw new Error(`Group '${value}' not found on tab '${tabId}'.`);
}

function resolveNodeKeyAnywhere(spec: AuthoringSpec, priorFlows: FlowsJson, value: string): string {
  for (const tab of spec.tabs) {
    if (tab.nodes.some((n) => n.key === value)) return value;
  }
  const match = findPriorCanvasMatch(priorFlows, value);
  if (match !== undefined && match.kind === 'node') {
    const tab = spec.tabs.find((t) => t.id === match.tabId);
    if (tab?.nodes.some((n) => n.key === match.key) === true) return match.key;
  }
  throw new Error(`Node '${value}' not found in spec.`);
}

interface PriorCanvasMatch {
  readonly kind: 'node' | 'junction' | 'comment';
  readonly key: string;
  readonly tabId: string;
}

function findPriorCanvasMatch(
  priorFlows: FlowsJson,
  nodeRedId: string,
): PriorCanvasMatch | undefined {
  for (const flowNode of priorFlows) {
    if (flowNode.id !== nodeRedId) continue;
    const kind = canvasKind(flowNode);
    if (kind === undefined) continue;
    const z = (flowNode as { z?: unknown }).z;
    if (typeof z !== 'string') continue;
    const tabId = authoringTabIdForNodeRedTabId(priorFlows, z);
    if (tabId === undefined) continue;
    return { kind, key: authoringKey(flowNode), tabId };
  }
  return undefined;
}

function findPriorGroupMatch(
  priorFlows: FlowsJson,
  nodeRedId: string,
): { readonly key: string; readonly tabId: string } | undefined {
  const group = priorFlows.find((n) => isGroup(n) && n.id === nodeRedId);
  if (group === undefined) return undefined;
  if (typeof group.z !== 'string') return undefined;
  const tabId = authoringTabIdForNodeRedTabId(priorFlows, group.z);
  return tabId === undefined ? undefined : { key: authoringKey(group), tabId };
}

function canvasKind(node: FlowsJsonNode): PriorCanvasMatch['kind'] | undefined {
  if (isRegularNode(node)) return 'node';
  if (isJunction(node)) return 'junction';
  if (isComment(node)) return 'comment';
  return undefined;
}

function authoringTabIdForNodeRedTabId(
  priorFlows: FlowsJson,
  nodeRedTabId: string,
): string | undefined {
  const tab = priorFlows.find((n) => isTab(n) && n.id === nodeRedTabId);
  return tab === undefined ? undefined : authoringKey(tab);
}

function authoringKey(node: FlowsJsonNode): string {
  const ext = (node as Record<string, unknown>)['_authoringKey'];
  return typeof ext === 'string' ? ext : node.id;
}

function wireParticipants(
  spec: AuthoringSpec,
  tabId: string,
  fromKey: string,
  toKey: string,
  opts: { readonly outputPort: number },
): { readonly spec: AuthoringSpec; readonly added: boolean } {
  if (fromKey === toKey)
    throw new Error(`Refusing to wire '${fromKey}' to itself on tab '${tabId}'.`);
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new Error(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;
  assertWireSourcePort(tab, fromKey, opts.outputPort);
  if (!hasWireTarget(tab, toKey)) throw new Error(`Target '${toKey}' not found on tab '${tabId}'.`);
  const exists = tab.connections.some(
    (c) => c.fromKey === fromKey && c.outputPort === opts.outputPort && c.toKey === toKey,
  );
  if (exists) return { spec, added: false };
  const updatedTab: TabSpec = {
    ...tab,
    connections: [...tab.connections, { fromKey, outputPort: opts.outputPort, toKey }],
  };
  return {
    spec: { ...spec, tabs: spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t)) },
    added: true,
  };
}

function setParticipantWires(
  spec: AuthoringSpec,
  opts: {
    readonly tabId: string;
    readonly sourceKey: string;
    readonly outputPort: number;
    readonly targetKeys: readonly string[];
  },
): { readonly spec: AuthoringSpec; readonly removed: number; readonly added: number } {
  const tabIndex = spec.tabs.findIndex((t) => t.id === opts.tabId);
  if (tabIndex < 0) throw new Error(`Tab '${opts.tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;
  assertWireSourcePort(tab, opts.sourceKey, opts.outputPort);
  const targetKeys: string[] = [];
  const seen = new Set<string>();
  for (const key of opts.targetKeys) {
    if (key === opts.sourceKey) throw new Error(`Refusing to wire '${opts.sourceKey}' to itself.`);
    if (!hasWireTarget(tab, key))
      throw new Error(`Target '${key}' not found on tab '${opts.tabId}'.`);
    if (!seen.has(key)) {
      seen.add(key);
      targetKeys.push(key);
    }
  }
  let removed = 0;
  const kept: ConnectionSpec[] = [];
  for (const c of tab.connections) {
    if (c.fromKey === opts.sourceKey && c.outputPort === opts.outputPort) {
      removed += 1;
    } else {
      kept.push(c);
    }
  }
  const added = targetKeys.map((toKey) => ({
    fromKey: opts.sourceKey,
    outputPort: opts.outputPort,
    toKey,
  }));
  const updatedTab: TabSpec = { ...tab, connections: [...kept, ...added] };
  return {
    spec: { ...spec, tabs: spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t)) },
    removed,
    added: added.length,
  };
}

function assertWireSourcePort(tab: TabSpec, sourceKey: string, outputPort: number): void {
  const sourceNode = tab.nodes.find((n) => n.key === sourceKey);
  if (sourceNode !== undefined) {
    const outputs = getOutputPortCount(sourceNode.type, sourceNode.passthrough);
    if (!Number.isInteger(outputPort) || outputPort < 0 || outputPort >= outputs) {
      throw new Error(
        `Output port ${outputPort} out of range for node '${sourceKey}' (type '${sourceNode.type}' has ${outputs} output(s)).`,
      );
    }
    return;
  }
  if ((tab.junctions ?? []).some((j) => j.key === sourceKey)) {
    if (outputPort !== 0)
      throw new Error(
        `Output port ${outputPort} out of range for junction '${sourceKey}' (has 1 output).`,
      );
    return;
  }
  throw new Error(`Source '${sourceKey}' not found on tab '${tab.id}'.`);
}

function hasWireTarget(tab: TabSpec, key: string): boolean {
  return tab.nodes.some((n) => n.key === key) || (tab.junctions ?? []).some((j) => j.key === key);
}
