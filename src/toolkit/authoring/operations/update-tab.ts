import type { AuthoringSpec, TabEnvEntry, TabSpec } from '../types.js';

export interface UpdateTabOpts {
  label?: string;
  info?: string;
  /** Replaces the tab env array wholesale. Use [] to clear existing entries. */
  env?: readonly TabEnvEntry[];
}

export interface UpdateTabResult {
  spec: AuthoringSpec;
  updated: boolean;
}

class UpdateTabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateTabError';
  }
}

export function updateTab(
  spec: AuthoringSpec,
  tabId: string,
  opts: UpdateTabOpts,
): UpdateTabResult {
  if (opts.label === undefined && opts.info === undefined && opts.env === undefined) {
    throw new UpdateTabError('updateTab requires at least one field: label, info, or env.');
  }

  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new UpdateTabError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const updatedTab: TabSpec = {
    ...tab,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.info !== undefined ? { info: opts.info } : {}),
    ...(opts.env !== undefined ? { env: opts.env.map((e) => ({ ...e })) } : {}),
  };

  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, updated: true };
}
