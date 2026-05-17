/**
 * Authoring spec model — the typed surface that agents and tools manipulate.
 *
 * The compiler (`compile.ts`) turns this into Node-RED `flows.json`.
 * The decompiler (`decompile.ts`) recovers it from `flows.json` (with the
 * `_authoringKey` extension property bridging spec keys ↔ Node-RED IDs).
 *
 * The model covers tabs, workspace nodes, config nodes, subflow definitions,
 * groups, comments, and wires. Dashboard widgets are represented as regular
 * NodeSpecs plus dashboard config nodes.
 */

export interface Position {
  readonly x: number;
  readonly y: number;
}

/**
 * Anchor kinds for Dashboard 2.0 widget → config-node references. A `ui-template`
 * widget anchors to a `ui-base` (`templateScope='widget:ui'`), a `ui-page`
 * (`templateScope='widget:page'`), or a `ui-group` (the default scope).
 * Other dashboard widgets always anchor to a group.
 */
export type WidgetAnchorKind = 'group' | 'page' | 'ui';

export interface WidgetAnchor {
  readonly kind: WidgetAnchorKind;
  /** Authoring-key of the target config node (resolved by the compiler). */
  readonly refKey: string;
}

export interface NodeSpec {
  /** Stable, agent-meaningful identifier within the tab. Bridges to flows.json id. */
  readonly key: string;
  /** Node-RED node type, e.g. 'inject', 'debug', 'function'. */
  readonly type: string;
  /** Visible label (≤ 24 chars by default; enforced by `label-cap` validator). */
  readonly label?: string;
  readonly position: Position;
  /** Membership in a group declared in the same TabSpec. */
  readonly groupKey?: string;
  /**
   * Dashboard 2.0 widget anchor (group / page / ui). When set, the compiler
   * emits `passthrough.<kind> = compiledConfigId(refKey)`. Backward-compatible:
   * widgets without this field can still set `group` directly via passthrough.
   */
  readonly widgetAnchor?: WidgetAnchor;
  /** Type-specific fields (payload, func code, mqtt topic, etc.). */
  readonly passthrough?: Readonly<Record<string, unknown>>;
}

export interface ConfigNodeSpec {
  /** Stable identifier for a global Node-RED config node. */
  readonly key: string;
  /** Node-RED config node type, e.g. 'mqtt-broker' or 'ui_group'. */
  readonly type: string;
  readonly label?: string;
  readonly passthrough?: Readonly<Record<string, unknown>>;
}

export interface ConnectionSpec {
  readonly fromKey: string;
  readonly outputPort: number;
  readonly toKey: string;
}

export interface GroupSpec {
  readonly key: string;
  readonly name: string;
  readonly nodeKeys: readonly string[];
  /** Top-left corner. Node-RED auto-fits when missing; preserved verbatim when present. */
  readonly position?: Position;
  /** Width/height in pixels. */
  readonly size?: { readonly w: number; readonly h: number };
  /** Parent group key (Node-RED 3.0+ nested groups). Compiles to the `g` field. */
  readonly parentKey?: string;
  /** Per-group info annotation (Node-RED 4.1+). */
  readonly info?: string;
  /** Visual styling (fill, stroke, label, etc.) — opaque to the toolkit. */
  readonly style?: Readonly<Record<string, unknown>>;
  /** Forward-compat catch-all for any future Node-RED group fields. */
  readonly passthrough?: Readonly<Record<string, unknown>>;
}

export interface CommentSpec {
  readonly key: string;
  readonly text: string;
  readonly position: Position;
  /** Width/height in pixels. */
  readonly size?: { readonly w: number; readonly h: number };
  readonly info?: string;
  readonly groupKey?: string;
}

/**
 * Junction — Node-RED 3.0+ wire-routing waypoint. One input, one output port.
 * Wires onto and off of a junction are modeled through `TabSpec.connections`
 * like any other node.
 */
export interface JunctionSpec {
  readonly key: string;
  readonly position: Position;
  readonly name?: string;
  readonly groupKey?: string;
  /** Compiles to the `d` (disabled) field. */
  readonly disabled?: boolean;
}

/**
 * Tab-level environment-variable entry (Node-RED uses the same shape as
 * subflow env entries). Closed `type` set per flows-json schema.
 */
export interface TabEnvEntry {
  readonly name: string;
  readonly type: 'str' | 'num' | 'bool' | 'json' | 'env' | 'cred' | 'jsonata' | 'conf-type';
  readonly value?: unknown;
  readonly ui?: Readonly<Record<string, unknown>>;
}

export interface TabSpec {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly info?: string;
  /** Tab-level lock flag (Node-RED 3.1+). */
  readonly locked?: boolean;
  /** Tab-level typed environment variables. */
  readonly env?: readonly TabEnvEntry[];
  readonly nodes: readonly NodeSpec[];
  readonly connections: readonly ConnectionSpec[];
  readonly groups: readonly GroupSpec[];
  readonly comments: readonly CommentSpec[];
  readonly junctions?: readonly JunctionSpec[];
  /** Forward-compat catch-all for any future Node-RED tab fields. */
  readonly passthrough?: Readonly<Record<string, unknown>>;
}

export interface SubflowDefSpec {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly NodeSpec[];
  readonly connections: readonly ConnectionSpec[];
  readonly junctions?: readonly JunctionSpec[];
  readonly passthrough?: Readonly<Record<string, unknown>>;
}

export interface AuthoringSpec {
  readonly tabs: readonly TabSpec[];
  readonly configNodes?: readonly ConfigNodeSpec[];
  readonly subflowDefs?: readonly SubflowDefSpec[];
}

/**
 * Default output-port count by node type. The compiler uses this to size each
 * node's `wires` array. `function` nodes can override via passthrough.outputs.
 */
export const DEFAULT_OUTPUT_PORT_COUNT: Readonly<Record<string, number>> = {
  inject: 1,
  debug: 0,
  function: 1,
  switch: 1,
  change: 1,
  template: 1,
  link_in: 1,
  'link in': 1,
  link_out: 0,
  'link out': 0,
  'link call': 1,
  'mqtt in': 1,
  'mqtt out': 0,
  catch: 1,
  status: 1,
  complete: 1,
  comment: 0,
};

/**
 * Node types that declare their output port count via a `passthrough.outputs`
 * number. The compiler honors this on any of these types; otherwise it
 * derives the count from `DEFAULT_OUTPUT_PORT_COUNT` or, for switch nodes,
 * `passthrough.rules.length` when `outputs` is absent.
 */
const OUTPUTS_FIELD_TYPES = new Set([
  'function',
  'switch',
  'trigger',
  // `delay` in `rate-limit` mode can split into 2 outputs; honor `outputs`
  // if explicitly set on the node spec.
  'delay',
]);

export function getOutputPortCount(
  type: string,
  passthrough?: Readonly<Record<string, unknown>>,
): number {
  if (OUTPUTS_FIELD_TYPES.has(type) && typeof passthrough?.['outputs'] === 'number') {
    return passthrough['outputs'];
  }
  // Switch nodes commonly omit `outputs` and let the rule count determine
  // it. Read the array length if it's there; rules.length wins over the
  // generic default of 1.
  if (type === 'switch') {
    const rules = passthrough?.['rules'];
    if (Array.isArray(rules)) return rules.length;
  }
  const known = DEFAULT_OUTPUT_PORT_COUNT[type];
  return known ?? 1;
}
