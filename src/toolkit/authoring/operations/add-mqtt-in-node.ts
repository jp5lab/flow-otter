import type { AuthoringSpec, NodeSpec, TabSpec } from '../types.js';

import { defaultSpawnPosition } from './_spawn.js';

export interface AddMqttInNodeOpts {
  /** Visible label (≤ 24 chars). Defaults to 'MQTT In'. */
  label?: string;
  /** Custom key. Auto-generated as `mqtt-in` (with collision suffix) if omitted. */
  key?: string;
  /** Node-RED mqtt-in passthrough (topic, qos, broker, datatype, etc.). */
  passthrough?: Readonly<Record<string, unknown>>;
  /** Membership in an existing group. */
  groupKey?: string;
}

export interface AddMqttInNodeResult {
  spec: AuthoringSpec;
  newNodeKey: string;
}

const DEFAULTS = {
  label: 'MQTT In',
  baseKey: 'mqtt-in',
};

class AddMqttInNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddMqttInNodeError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addMqttInNode(
  spec: AuthoringSpec,
  tabId: string,
  opts: AddMqttInNodeOpts = {},
): AddMqttInNodeResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddMqttInNodeError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const taken = new Set(tab.nodes.map((n) => n.key));
  const newKey = uniqueKey(opts.key ?? DEFAULTS.baseKey, taken);
  const position = defaultSpawnPosition(tab);

  const newNode: NodeSpec = {
    key: newKey,
    type: 'mqtt in',
    label: opts.label ?? DEFAULTS.label,
    position,
    ...(opts.groupKey !== undefined ? { groupKey: opts.groupKey } : {}),
    ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
  };

  const updatedTab: TabSpec = {
    ...tab,
    nodes: [...tab.nodes, newNode],
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, newNodeKey: newKey };
}
