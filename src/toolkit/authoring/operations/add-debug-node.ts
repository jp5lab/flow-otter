import { placeRightOf } from '../../layout/placement.js';
import type { AuthoringSpec, ConnectionSpec, NodeSpec, TabSpec } from '../types.js';

export interface AddDebugNodeOpts {
  /** Visible label (≤ 24 chars). Defaults to 'Debug'. */
  label?: string;
  /** msg field to display. Defaults to 'payload'. */
  complete?: string;
  /** Whether the debug output is active. Defaults to true. */
  active?: boolean;
  /** Mirror to Node-RED's stdout console. Defaults to false. */
  console?: boolean;
  /** Output port on the source node. Defaults to 0. */
  sourceOutputPort?: number;
}

export interface AddDebugNodeResult {
  spec: AuthoringSpec;
  newNodeKey: string;
}

const DEFAULTS = {
  label: 'Debug',
  complete: 'payload',
  active: true,
  console: false,
  sourceOutputPort: 0,
};

class AddDebugNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddDebugNodeError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addDebugNode(
  spec: AuthoringSpec,
  tabId: string,
  sourceNodeKey: string,
  opts: AddDebugNodeOpts = {},
): AddDebugNodeResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddDebugNodeError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const source = tab.nodes.find((n) => n.key === sourceNodeKey);
  if (!source) {
    throw new AddDebugNodeError(`Source node '${sourceNodeKey}' not found on tab '${tabId}'.`);
  }

  const label = opts.label ?? DEFAULTS.label;
  const complete = opts.complete ?? DEFAULTS.complete;
  const active = opts.active ?? DEFAULTS.active;
  const consoleOn = opts.console ?? DEFAULTS.console;
  const sourceOutputPort = opts.sourceOutputPort ?? DEFAULTS.sourceOutputPort;

  const takenKeys = new Set(tab.nodes.map((n) => n.key));
  const baseKey = `${sourceNodeKey}__debug`;
  const newKey = uniqueKey(baseKey, takenKeys);

  const position = placeRightOf(source.position);

  const newNode: NodeSpec = {
    key: newKey,
    type: 'debug',
    label,
    position,
    ...(source.groupKey !== undefined ? { groupKey: source.groupKey } : {}),
    passthrough: {
      active,
      tosidebar: true,
      console: consoleOn,
      tostatus: false,
      complete,
      targetType: 'msg',
      statusVal: '',
      statusType: 'auto',
    },
  };

  const newConnection: ConnectionSpec = {
    fromKey: sourceNodeKey,
    outputPort: sourceOutputPort,
    toKey: newKey,
  };

  const updatedTab: TabSpec = {
    ...tab,
    nodes: [...tab.nodes, newNode],
    connections: [...tab.connections, newConnection],
  };

  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));

  return {
    spec: { ...spec, tabs: updatedTabs },
    newNodeKey: newKey,
  };
}
