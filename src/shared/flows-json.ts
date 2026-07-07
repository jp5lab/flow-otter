import { z } from 'zod';

/**
 * Node-RED `flows.json` document model.
 *
 * The file is a single flat array containing tabs, regular nodes, config nodes,
 * subflow definitions, subflow instances, groups, and comments — distinguished by
 * the `type` field. We intentionally use permissive schemas (`.passthrough()`) so
 * that arbitrary node types and contrib-module-specific properties round-trip
 * without loss; structural validators in `src/toolkit/validate/` enforce the
 * cross-cutting invariants.
 */

export const SUBFLOW_INSTANCE_PREFIX = 'subflow:';
export const RESERVED_TYPES = new Set(['tab', 'subflow', 'group', 'comment', 'junction']);

const KNOWN_CONFIG_NODE_TYPES: ReadonlySet<string> = new Set([
  'mqtt-broker',
  'tls-config',
  'ui-base',
  'ui-page',
  'ui-group',
  'ui-theme',
  'ui_base',
  'ui_tab',
  'ui_group',
  'ui_theme',
]);

/**
 * Scalar string props under these keys never mark their target as a config
 * node: wiring/topology (`wires`, `links`, `scope`), placement (`g`, `z`),
 * flags (`d`) and the node's own `id`.
 */
export const CONFIG_REF_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  'wires',
  'links',
  'scope',
  'g',
  'z',
  'd',
  'id',
]);

export function isKnownConfigNodeType(type: string): boolean {
  return KNOWN_CONFIG_NODE_TYPES.has(type);
}

/**
 * Subflow `env` entry — typed environment-variable definition. The closed
 * `envType` set is `{str, num, bool, json, env, cred, jsonata, conf-type}`;
 * `conf-type` was added in Node-RED 4.0 (#4587).
 */
export const SubflowEnvEntrySchema = z
  .object({
    name: z.string(),
    type: z.enum(['str', 'num', 'bool', 'json', 'env', 'cred', 'jsonata', 'conf-type']),
    value: z.unknown().optional(),
    ui: z.record(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Subflow input port — references internal nodes by id+port.
 */
export const SubflowPortSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    wires: z.array(z.object({ id: z.string(), port: z.number().optional() })).optional(),
  })
  .passthrough();

export const TabNodeSchema = z
  .object({
    id: z.string(),
    type: z.literal('tab'),
    label: z.string(),
    disabled: z.boolean().optional(),
    info: z.string().optional(),
    env: z.array(SubflowEnvEntrySchema).optional(),
    /** Tab-level lock flag — Node-RED 3.1+. */
    locked: z.boolean().optional(),
  })
  .passthrough();

export const SubflowDefSchema = z
  .object({
    id: z.string(),
    type: z.literal('subflow'),
    name: z.string(),
    info: z.string().optional(),
    category: z.string().optional(),
    in: z.array(SubflowPortSchema).optional(),
    out: z.array(SubflowPortSchema).optional(),
    env: z.array(SubflowEnvEntrySchema).optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
    /** Subflow visual status indicator wiring (Node-RED 1.0+). */
    status: z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
        wires: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    /** Subflow editor metadata (Node-RED 1.0+). */
    meta: z.record(z.unknown()).optional(),
    inputLabels: z.array(z.string()).optional(),
    outputLabels: z.array(z.string()).optional(),
  })
  .passthrough();

export const GroupNodeSchema = z
  .object({
    id: z.string(),
    type: z.literal('group'),
    z: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    name: z.string().optional(),
    style: z.record(z.unknown()).optional(),
    nodes: z.array(z.string()),
    /** Per-node info annotation — Node-RED 4.1+. */
    info: z.string().optional(),
    /** Parent group id for nested groups — Node-RED 3.0+. */
    g: z.string().optional(),
  })
  .passthrough();

export const CommentNodeSchema = z
  .object({
    id: z.string(),
    type: z.literal('comment'),
    z: z.string(),
    x: z.number(),
    y: z.number(),
    w: z.number().optional(),
    h: z.number().optional(),
    name: z.string().optional(),
    info: z.string().optional(),
    g: z.string().optional(),
    /** FlowOtter authoring extension: comment is a header for this group key. */
    _authoringHeaderFor: z.string().optional(),
  })
  .passthrough();

/**
 * Junction node — Node-RED 3.0+. Wire-routing waypoint with a single input and
 * a single output port. `wires` is `[[<targetId>, ...]]` (one output port).
 */
export const JunctionNodeSchema = z
  .object({
    id: z.string(),
    type: z.literal('junction'),
    z: z.string(),
    x: z.number(),
    y: z.number(),
    wires: z.array(z.array(z.string())),
    name: z.string().optional(),
    g: z.string().optional(),
    d: z.boolean().optional(),
  })
  .passthrough();

/**
 * Regular workspace node OR config node OR subflow instance — anything whose
 * `type` is not one of the reserved discriminators.
 */
export const RegularNodeSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    z: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    wires: z.array(z.array(z.string())).optional(),
    name: z.string().optional(),
    g: z.string().optional(),
    /** Per-node disabled flag (1-letter d, distinct from tab-level `disabled`). */
    d: z.boolean().optional(),
    /** Link-label visibility, used by `link in`/`link out` nodes. */
    l: z.boolean().optional(),
    /** Per-node info annotation — Node-RED 4.1+. */
    info: z.string().optional(),
    /**
     * Inline node-level credentials. Normally Node-RED stores credentials in a
     * sibling `<flowFile>.credentials.json`, but external tools (and POST /flows
     * via the `credentials` body field) can attach them inline. FlowOtter's
     * decompile path strips this to avoid leaking secrets via flows.json.
     */
    credentials: z.record(z.unknown()).optional(),
  })
  .passthrough()
  .refine((n) => !RESERVED_TYPES.has(n.type), {
    message: 'type collides with reserved discriminator',
  });

export const FlowsJsonNodeSchema = z.union([
  TabNodeSchema,
  SubflowDefSchema,
  GroupNodeSchema,
  CommentNodeSchema,
  JunctionNodeSchema,
  RegularNodeSchema,
]);

export const FlowsJsonSchema = z.array(FlowsJsonNodeSchema);

export type TabNode = z.infer<typeof TabNodeSchema>;
export type SubflowDefNode = z.infer<typeof SubflowDefSchema>;
export type GroupNode = z.infer<typeof GroupNodeSchema>;
export type CommentNode = z.infer<typeof CommentNodeSchema>;
export type JunctionNode = z.infer<typeof JunctionNodeSchema>;
export type RegularNode = z.infer<typeof RegularNodeSchema>;
export type FlowsJsonNode = z.infer<typeof FlowsJsonNodeSchema>;
export type FlowsJson = z.infer<typeof FlowsJsonSchema>;

export function isTab(n: FlowsJsonNode): n is TabNode {
  return n.type === 'tab';
}

export function isSubflowDef(n: FlowsJsonNode): n is SubflowDefNode {
  return n.type === 'subflow';
}

export function isSubflowInstance(n: FlowsJsonNode): boolean {
  return typeof n.type === 'string' && n.type.startsWith(SUBFLOW_INSTANCE_PREFIX);
}

export function isGroup(n: FlowsJsonNode): n is GroupNode {
  return n.type === 'group';
}

export function isComment(n: FlowsJsonNode): n is CommentNode {
  return n.type === 'comment';
}

export function isJunction(n: FlowsJsonNode): n is JunctionNode {
  return n.type === 'junction';
}

/**
 * Returns true when the node is a workspace-laid-out node (regular, subflow
 * instance, group, comment) — i.e., it has `z`, `x`, `y` semantics.
 */
export function hasCanvasPosition(n: FlowsJsonNode): n is FlowsJsonNode & { x: number; y: number } {
  const r = n as { x?: unknown; y?: unknown };
  return typeof r.x === 'number' && typeof r.y === 'number';
}

/**
 * Returns true when the node is a "regular" workspace node (debug, inject,
 * function, mqtt in/out, etc.) — distinguishable from config nodes by the
 * presence of `z`, `x`, `y`, and `wires` fields. Junctions are excluded;
 * they have their own discriminator.
 */
export function isRegularNode(n: FlowsJsonNode): n is RegularNode {
  if (isTab(n) || isSubflowDef(n) || isGroup(n) || isComment(n) || isJunction(n)) return false;
  return 'z' in n && 'x' in n && 'y' in n && 'wires' in n;
}

/**
 * Config nodes have no x/y/wires (they're referenced by id from regular nodes).
 */
export function isConfigNode(n: FlowsJsonNode): n is RegularNode {
  if (isTab(n) || isSubflowDef(n) || isGroup(n) || isComment(n) || isJunction(n)) return false;
  return !('x' in n) && !('y' in n) && !('wires' in n);
}

/**
 * Ids of nodes referenced from another node's scalar string prop. This catches
 * adopted config nodes that were historically stamped with canvas fields.
 */
export function configByReferenceIds(flows: FlowsJson): Set<string> {
  const ids = new Set<string>();
  for (const n of flows) ids.add(n.id);
  const referenced = new Set<string>();
  for (const n of flows) {
    for (const [key, value] of Object.entries(n)) {
      if (CONFIG_REF_EXCLUDED_KEYS.has(key)) continue;
      if (typeof value === 'string' && value !== n.id && ids.has(value)) referenced.add(value);
    }
  }
  return referenced;
}

export function isConfigShapedNode(
  n: FlowsJsonNode,
  referencedConfigIds?: ReadonlySet<string>,
): n is RegularNode {
  const { id, type } = n;
  if (isTab(n) || isSubflowDef(n) || isGroup(n) || isComment(n) || isJunction(n)) return false;
  return isConfigNode(n) || isKnownConfigNodeType(type) || referencedConfigIds?.has(id) === true;
}
