import type { AuthoringSpec, ConnectionSpec, NodeSpec, TabSpec } from '../types.js';
import { getOutputPortCount } from '../types.js';

export interface SetWiresOpts {
  readonly tabId: string;
  readonly sourceKey: string;
  readonly outputPort: number;
  readonly targetKeys: readonly string[];
}

export interface SetWiresResult {
  readonly spec: AuthoringSpec;
  /** Number of pre-existing wires removed from (sourceKey, outputPort). */
  readonly removed: number;
  /** Number of new wires added (== targetKeys.length, unless any duplicates collapse). */
  readonly added: number;
}

class SetWiresError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetWiresError';
  }
}

/**
 * Atomically replace the wires originating at `(sourceKey, outputPort)` with
 * connections to the given `targetKeys`. Pass `targetKeys: []` to clear the
 * port. Targets must live on the same tab as the source; cross-tab connections
 * go through link nodes (see `setLinks`) and are not modeled as connections.
 *
 * Idempotent: re-running with the same targetKeys yields the same spec.
 */
export function setWires(spec: AuthoringSpec, opts: SetWiresOpts): SetWiresResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === opts.tabId);
  if (tabIndex < 0) {
    throw new SetWiresError(`Tab '${opts.tabId}' not found in spec.`);
  }
  const tab = spec.tabs[tabIndex] as TabSpec;
  const sourceNode = tab.nodes.find((n) => n.key === opts.sourceKey);
  if (!sourceNode) {
    throw new SetWiresError(`Source node '${opts.sourceKey}' not found on tab '${opts.tabId}'.`);
  }
  const sourceOutputs = getOutputPortCount(sourceNode.type, sourceNode.passthrough);
  if (
    !Number.isInteger(opts.outputPort) ||
    opts.outputPort < 0 ||
    opts.outputPort >= sourceOutputs
  ) {
    throw new SetWiresError(
      `Output port ${opts.outputPort} out of range for node '${opts.sourceKey}' (type '${sourceNode.type}' has ${sourceOutputs} output(s)).`,
    );
  }

  const validTargetKeys = new Set<string>(tab.nodes.map((n) => n.key));
  const dedupedTargets: string[] = [];
  const seen = new Set<string>();
  for (const targetKey of opts.targetKeys) {
    if (targetKey === opts.sourceKey) {
      throw new SetWiresError(`Refusing to wire node '${opts.sourceKey}' to itself.`);
    }
    if (!validTargetKeys.has(targetKey)) {
      throw new SetWiresError(
        `Target node '${targetKey}' not found on tab '${opts.tabId}' (cross-tab wires require link nodes).`,
      );
    }
    if (!seen.has(targetKey)) {
      seen.add(targetKey);
      dedupedTargets.push(targetKey);
    }
  }

  const kept: ConnectionSpec[] = [];
  let removed = 0;
  for (const c of tab.connections) {
    if (c.fromKey === opts.sourceKey && c.outputPort === opts.outputPort) {
      removed += 1;
      continue;
    }
    kept.push(c);
  }
  const added: ConnectionSpec[] = dedupedTargets.map((toKey) => ({
    fromKey: opts.sourceKey,
    outputPort: opts.outputPort,
    toKey,
  }));

  const updatedTab: TabSpec = {
    ...tab,
    connections: [...kept, ...added],
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  void (sourceNode satisfies NodeSpec);
  return {
    spec: { ...spec, tabs: updatedTabs },
    removed,
    added: added.length,
  };
}
