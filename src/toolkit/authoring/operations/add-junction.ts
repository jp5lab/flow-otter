import { snapToGrid } from '../../layout/grid.js';
import type { AuthoringSpec, JunctionSpec, Position, TabSpec } from '../types.js';

import { hasCanvasObject, updateSingleMemberGroupKey } from './_membership.js';
import { defaultSpawnPosition } from './_spawn.js';

export interface AddJunctionOpts {
  /** Custom key. Auto-generated as `junction` (with collision suffix) if omitted. */
  key?: string;
  /** Position. Defaults to `defaultSpawnPosition(tab)`. */
  position?: Position;
  /** Optional editor label for the junction. */
  name?: string;
  /** Membership in an existing group. */
  groupKey?: string;
  /** Compiles to Node-RED's `d` disabled field. */
  disabled?: boolean;
}

export interface AddJunctionResult {
  spec: AuthoringSpec;
  newJunctionKey: string;
}

const DEFAULTS = {
  baseKey: 'junction',
};

class AddJunctionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddJunctionError';
  }
}

function uniqueKey(base: string, tab: TabSpec): string {
  if (!hasCanvasObject(tab, base)) return base;
  let i = 2;
  while (hasCanvasObject(tab, `${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addJunction(
  spec: AuthoringSpec,
  tabId: string,
  opts: AddJunctionOpts = {},
): AddJunctionResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddJunctionError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const newKey = uniqueKey(opts.key ?? DEFAULTS.baseKey, tab);
  const newJunction: JunctionSpec = {
    key: newKey,
    position: snapToGrid(opts.position ?? defaultSpawnPosition(tab)),
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.groupKey !== undefined ? { groupKey: opts.groupKey } : {}),
    ...(opts.disabled !== undefined ? { disabled: opts.disabled } : {}),
  };

  const tabWithJunction: TabSpec = {
    ...tab,
    junctions: [...(tab.junctions ?? []), newJunction],
  };
  const membership =
    opts.groupKey !== undefined
      ? updateSingleMemberGroupKey(tabWithJunction, newKey, opts.groupKey)
      : undefined;
  const updatedTab: TabSpec = membership ? { ...tabWithJunction, ...membership } : tabWithJunction;
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, newJunctionKey: newKey };
}
