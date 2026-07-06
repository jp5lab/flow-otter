import { isKnownConfigNodeType } from '../../../shared/flows-json.js';
import { snapToGrid } from '../../layout/grid.js';
import { placeRightOf } from '../../layout/placement.js';
import type { AuthoringSpec, ConfigNodeSpec, ConnectionSpec, NodeSpec, TabSpec } from '../types.js';

export interface AddNodeOpts {
  /** Caller-supplied stable key. If omitted, derives from type. */
  key?: string;
  /** Visible label (≤ LABEL_CAP_CHARS). */
  label?: string;
  /** Position on the canvas. Snapped to grid. */
  position?: { x: number; y: number };
  /** Optional group anchor key. */
  groupKey?: string;
  /** Node-RED type-specific config fields. Validated by the per-type schema if registered. */
  passthrough?: Record<string, unknown>;
  /** When set, also wires a connection from this source node's output. */
  sourceNodeKey?: string;
  /** Output port on the source node (default 0). */
  sourceOutputPort?: number;
}

export interface AddNodeResult {
  spec: AuthoringSpec;
  newNodeKey: string;
  /** True when a wire was added because sourceNodeKey was supplied. */
  wired: boolean;
  kind: 'node' | 'config';
}

class AddNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddNodeError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function deriveBaseKey(type: string, label: string | undefined): string {
  const fromLabel = label
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (fromLabel && fromLabel.length > 0) return fromLabel;
  return type.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/**
 * Generic add-node operation. Adds a node of any Node-RED type to a tab.
 *
 * Per-type field validation happens in the MCP-layer tool via the
 * `node-schemas` registry — this operation trusts the passthrough as-is.
 * If `sourceNodeKey` is set, also wires a single connection.
 */
export function addNode(
  spec: AuthoringSpec,
  tabId: string,
  type: string,
  opts: AddNodeOpts = {},
): AddNodeResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddNodeError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const takenKeys = new Set(tab.nodes.map((n) => n.key));
  const baseKey = opts.key ?? deriveBaseKey(type, opts.label);
  const newKey = uniqueKey(baseKey, takenKeys);

  if (isKnownConfigNodeType(type)) {
    if (opts.sourceNodeKey !== undefined) {
      throw new AddNodeError(`Config node type '${type}' cannot be wired from sourceNodeKey.`);
    }
    const takenConfigKeys = new Set((spec.configNodes ?? []).map((n) => n.key));
    const configKey = uniqueKey(baseKey, takenConfigKeys);
    const newConfigNode: ConfigNodeSpec = {
      key: configKey,
      type,
      ...(opts.label !== undefined ? { label: opts.label } : {}),
      ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
    };
    return {
      spec: { ...spec, configNodes: [...(spec.configNodes ?? []), newConfigNode] },
      newNodeKey: configKey,
      wired: false,
      kind: 'config',
    };
  }

  let position: { x: number; y: number };
  if (opts.position) {
    position = snapToGrid(opts.position);
  } else if (opts.sourceNodeKey) {
    const source = tab.nodes.find((n) => n.key === opts.sourceNodeKey);
    if (!source) {
      throw new AddNodeError(`Source node '${opts.sourceNodeKey}' not found on tab '${tabId}'.`);
    }
    position = placeRightOf(source.position);
  } else {
    // Place at next free slot — simple top-down lane stack.
    const usedY = new Set(tab.nodes.map((n) => n.position.y));
    let y = 100;
    while (usedY.has(y)) y += 80;
    position = snapToGrid({ x: 160, y });
  }

  const newNode: NodeSpec = {
    key: newKey,
    type,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    position,
    ...(opts.groupKey !== undefined ? { groupKey: opts.groupKey } : {}),
    ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
  };

  let wired = false;
  let connections = tab.connections;
  if (opts.sourceNodeKey) {
    const newConnection: ConnectionSpec = {
      fromKey: opts.sourceNodeKey,
      outputPort: opts.sourceOutputPort ?? 0,
      toKey: newKey,
    };
    connections = [...tab.connections, newConnection];
    wired = true;
  }

  const updatedTab: TabSpec = {
    ...tab,
    nodes: [...tab.nodes, newNode],
    connections,
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));

  return {
    spec: { ...spec, tabs: updatedTabs },
    newNodeKey: newKey,
    wired,
    kind: 'node',
  };
}
