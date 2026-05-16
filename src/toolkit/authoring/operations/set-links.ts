import type { FlowsJson } from '../../../shared/flows-json.js';
import type { AuthoringSpec, NodeSpec, TabSpec } from '../types.js';

export interface SetLinksOpts {
  /**
   * Authoring key of the source link node. Must resolve to a `link out` or
   * `link call` node (these own the `links` field that points at peers).
   */
  readonly sourceKey: string;
  /**
   * Authoring keys of the peer link nodes to pair with. Each must resolve to
   * a `link in` node. Replacing the set is atomic; pass `[]` to clear.
   */
  readonly targetKeys: readonly string[];
  /**
   * Compiled prior flows, used to look up Node-RED IDs from authoring keys.
   * `passthrough.links` stores Node-RED IDs (not authoring keys) because
   * Node-RED resolves them at runtime — and the compiler preserves IDs across
   * recompiles, so IDs are stable.
   */
  readonly priorFlows: FlowsJson;
}

export interface SetLinksResult {
  readonly spec: AuthoringSpec;
  readonly paired: number;
}

const LINK_SOURCE_TYPES = new Set(['link out', 'link call']);
const LINK_IN_TYPE = 'link in';

class SetLinksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetLinksError';
  }
}

interface NodeLocation {
  readonly tabIndex: number;
  readonly nodeIndex: number;
  readonly tab: TabSpec;
  readonly node: NodeSpec;
}

function findNodeByKey(spec: AuthoringSpec, key: string): NodeLocation | undefined {
  for (let t = 0; t < spec.tabs.length; t++) {
    const tab = spec.tabs[t] as TabSpec;
    for (let n = 0; n < tab.nodes.length; n++) {
      const node = tab.nodes[n] as NodeSpec;
      if (node.key === key) {
        return { tabIndex: t, nodeIndex: n, tab, node };
      }
    }
  }
  return undefined;
}

function authoringKeyToId(flows: FlowsJson, key: string): string | undefined {
  for (const node of flows) {
    const ext = (node as Record<string, unknown>)['_authoringKey'];
    if (ext === key) return node.id;
    if (ext === undefined && node.id === key) return node.id;
  }
  return undefined;
}

/**
 * Set the cross-tab `links` pairing on a link-out / link-call node. Writes the
 * peers as Node-RED IDs into `passthrough.links` so the compiled flows.json
 * matches what Node-RED expects to resolve at runtime.
 *
 * `link out` (static mode) → `link in` peers.
 * `link call` → exactly one `link in` peer is the typical pattern, but the op
 * does not enforce a count restriction (Node-RED's own link-resolution
 * validator flags multi-target link-call).
 *
 * Idempotent: re-running with the same pairing produces the same spec.
 */
export function setLinks(spec: AuthoringSpec, opts: SetLinksOpts): SetLinksResult {
  const src = findNodeByKey(spec, opts.sourceKey);
  if (src === undefined) {
    throw new SetLinksError(`Source node '${opts.sourceKey}' not found in spec.`);
  }
  if (!LINK_SOURCE_TYPES.has(src.node.type)) {
    throw new SetLinksError(
      `Source node '${opts.sourceKey}' is type '${src.node.type}'; expected 'link out' or 'link call'.`,
    );
  }

  const peerIds: string[] = [];
  for (const targetKey of opts.targetKeys) {
    const peer = findNodeByKey(spec, targetKey);
    if (peer === undefined) {
      throw new SetLinksError(`Target node '${targetKey}' not found in spec.`);
    }
    if (peer.node.type !== LINK_IN_TYPE) {
      throw new SetLinksError(
        `Target node '${targetKey}' is type '${peer.node.type}'; expected '${LINK_IN_TYPE}'.`,
      );
    }
    const peerId = authoringKeyToId(opts.priorFlows, targetKey);
    if (peerId === undefined) {
      throw new SetLinksError(
        `Target node '${targetKey}' has no Node-RED id yet (not present in prior flows). Deploy the target node before pairing.`,
      );
    }
    peerIds.push(peerId);
  }

  const updatedNode: NodeSpec = {
    ...src.node,
    passthrough: {
      ...(src.node.passthrough ?? {}),
      links: peerIds,
    },
  };
  const updatedTab: TabSpec = {
    ...src.tab,
    nodes: src.tab.nodes.map((n, i) => (i === src.nodeIndex ? updatedNode : n)),
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === src.tabIndex ? updatedTab : t));
  return {
    spec: { ...spec, tabs: updatedTabs },
    paired: peerIds.length,
  };
}
