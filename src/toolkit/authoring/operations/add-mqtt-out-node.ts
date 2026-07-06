import type { AuthoringSpec, NodeSpec, TabSpec } from '../types.js';

import { defaultSpawnPosition } from './_spawn.js';

export interface AddMqttOutNodeOpts {
  /** Visible label (≤ 24 chars). Defaults to 'MQTT Out'. */
  label?: string;
  /** Custom key. Auto-generated as `mqtt-out` (with collision suffix) if omitted. */
  key?: string;
  /** Node-RED mqtt-out passthrough (topic, qos, retain, broker, etc.). */
  passthrough?: Readonly<Record<string, unknown>>;
  /** Membership in an existing group. */
  groupKey?: string;
}

export interface AddMqttOutNodeResult {
  spec: AuthoringSpec;
  newNodeKey: string;
}

const DEFAULTS = {
  label: 'MQTT Out',
  baseKey: 'mqtt-out',
};

class AddMqttOutNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddMqttOutNodeError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addMqttOutNode(
  spec: AuthoringSpec,
  tabId: string,
  opts: AddMqttOutNodeOpts = {},
): AddMqttOutNodeResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddMqttOutNodeError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const taken = new Set(tab.nodes.map((n) => n.key));
  const newKey = uniqueKey(opts.key ?? DEFAULTS.baseKey, taken);
  const label = opts.label ?? DEFAULTS.label;
  const position = defaultSpawnPosition(tab, {
    type: 'mqtt out',
    label,
    ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
  });

  const newNode: NodeSpec = {
    key: newKey,
    type: 'mqtt out',
    label,
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
