import {
  isComment,
  isGroup,
  isJunction,
  isSubflowDef,
  isTab,
  type FlowsJson,
} from '../../shared/flows-json.js';
import { ValidationFailedError } from '../tools/_tool.js';

function parseTypeList(spec: string): string[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Refuse to stage or deploy flows that exceed `MAX_FLOW_SIZE_BYTES`. The size
 * is the UTF-8 byte length of the canonical JSON encoding, matching what the
 * underlying flow-source adapters write to disk / POST to Node-RED.
 */
export function enforceMaxFlowSize(flows: FlowsJson, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(flows), 'utf8');
  if (bytes > maxBytes) {
    throw new ValidationFailedError(
      `Flow size ${bytes} bytes exceeds MAX_FLOW_SIZE_BYTES (${maxBytes}).`,
      [{ rule: 'max-flow-size', bytes, maxBytes }],
    );
  }
}

/**
 * Refuse to stage or deploy flows containing blocked node types, or — when
 * `ALLOWED_NODE_TYPES` is non-empty — node types outside the allowlist.
 *
 * Applies only to body nodes (regular workspace + config + subflow instances).
 * Tabs, subflow defs, groups, comments, and junctions are structural and
 * bypassed.
 */
export function enforceNodeTypePolicy(
  flows: FlowsJson,
  allowedSpec: string,
  blockedSpec: string,
): void {
  const allowed = parseTypeList(allowedSpec);
  const blocked = parseTypeList(blockedSpec);
  if (allowed.length === 0 && blocked.length === 0) return;
  const allowSet = new Set(allowed);
  const blockSet = new Set(blocked);
  for (const node of flows) {
    if (isTab(node) || isSubflowDef(node) || isGroup(node) || isComment(node) || isJunction(node)) {
      continue;
    }
    const t = node.type;
    if (blockSet.has(t)) {
      throw new ValidationFailedError(`Node type '${t}' is blocked by BLOCKED_NODE_TYPES.`, [
        { rule: 'blocked-node-type', nodeId: node.id, type: t },
      ]);
    }
    if (allowed.length > 0 && !allowSet.has(t)) {
      throw new ValidationFailedError(
        `Node type '${t}' is not in ALLOWED_NODE_TYPES (${allowed.join(', ')}).`,
        [{ rule: 'disallowed-node-type', nodeId: node.id, type: t }],
      );
    }
  }
}
