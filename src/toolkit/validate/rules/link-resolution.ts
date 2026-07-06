import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

import { findLinkCallTargets } from './_function-ast.js';

export const RULE = 'link-resolution';

const LINK_IN = 'link in';
const LINK_OUT = 'link out';
const LINK_CALL = 'link call';

function isLinkType(type: string): boolean {
  return type === LINK_IN || type === LINK_OUT || type === LINK_CALL;
}

function tabId(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function linksOf(node: FlowsJsonNode): string[] {
  const raw = (node as { links?: unknown }).links;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

/**
 * Returns true when a link-out / link-call routes via `msg.target` at runtime
 * rather than via the static `links` array. Added in Node-RED 3.0.
 */
function isDynamicLink(node: FlowsJsonNode): boolean {
  const t = (node as { linkType?: unknown }).linkType;
  return t === 'dynamic';
}

function nameOf(node: FlowsJsonNode): string | undefined {
  const n = (node as { name?: unknown }).name;
  return typeof n === 'string' && n.length > 0 ? n : undefined;
}

function functionCodeOf(node: FlowsJsonNode): string | undefined {
  const code = (node as { func?: unknown }).func;
  return typeof code === 'string' ? code : undefined;
}

function hasMatchingLinkIn(
  target: string,
  byId: ReadonlyMap<string, FlowsJsonNode>,
  linkInsByName: ReadonlyMap<string, readonly FlowsJsonNode[]>,
): boolean {
  const byExactId = byId.get(target);
  if (byExactId?.type === LINK_IN) return true;
  return (linkInsByName.get(target)?.length ?? 0) > 0;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map<string, FlowsJsonNode>();
  for (const node of flows) byId.set(node.id, node);

  // Detect duplicate `link in` names. Dynamic-mode link-out / link-call uses
  // name-based lookup at runtime, so duplicates are ambiguous and silently
  // pick whichever the runtime resolves first.
  const linkInsByName = new Map<string, FlowsJsonNode[]>();
  for (const node of flows) {
    if (node.type !== LINK_IN) continue;
    const name = nameOf(node);
    if (!name) continue;
    const existing = linkInsByName.get(name);
    if (existing) existing.push(node);
    else linkInsByName.set(name, [node]);
  }
  for (const [name, nodes] of linkInsByName) {
    if (nodes.length < 2) continue;
    for (const dup of nodes) {
      const t = tabId(dup);
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Duplicate 'link in' name '${name}' (${nodes.length} nodes share it). Dynamic-mode link-out / link-call resolves by name and picks ambiguously.`,
        nodeId: dup.id,
        ...(t !== undefined ? { tabId: t } : {}),
        context: { name, count: nodes.length, ids: nodes.map((n) => n.id) },
      });
    }
  }

  for (const node of flows) {
    if (node.type !== 'function') continue;
    const code = functionCodeOf(node);
    if (code === undefined || code.length === 0) continue;
    const sourceTab = tabId(node);

    for (const target of findLinkCallTargets(code)) {
      if (hasMatchingLinkIn(target, byId, linkInsByName)) continue;
      diagnostics.push({
        severity: 'warning',
        rule: RULE,
        message: `Function node '${node.id}' calls node.linkcall target '${target}' but no matching link-in id or name exists.`,
        nodeId: node.id,
        ...(sourceTab !== undefined ? { tabId: sourceTab } : {}),
        context: { target },
      });
    }
  }

  for (const node of flows) {
    if (typeof node.type !== 'string' || !isLinkType(node.type)) continue;

    const sourceTab = tabId(node);
    const dynamic = isDynamicLink(node);
    const peers = linksOf(node);

    // Dynamic link-out / link-call routes via msg.target at runtime — the
    // static links[] is not authoritative. Skip static-target checks.
    if (dynamic) continue;

    if (node.type === LINK_CALL && peers.length !== 1) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Link-call '${node.id}' must reference exactly one link-in (got ${peers.length}).`,
        nodeId: node.id,
        ...(sourceTab !== undefined ? { tabId: sourceTab } : {}),
        context: { count: peers.length },
      });
    }

    for (const peerId of peers) {
      const peer = byId.get(peerId);
      if (!peer) {
        diagnostics.push({
          severity: 'error',
          rule: RULE,
          message: `Link node '${node.id}' (${node.type}) references missing peer '${peerId}'.`,
          nodeId: node.id,
          ...(sourceTab !== undefined ? { tabId: sourceTab } : {}),
          context: { peerId },
        });
        continue;
      }

      if (node.type === LINK_OUT || node.type === LINK_CALL) {
        if (peer.type !== LINK_IN) {
          diagnostics.push({
            severity: 'error',
            rule: RULE,
            message: `Link node '${node.id}' (${node.type}) targets '${peerId}' which is type '${peer.type}', expected 'link in'.`,
            nodeId: node.id,
            ...(sourceTab !== undefined ? { tabId: sourceTab } : {}),
            context: { peerId, peerType: peer.type, expected: LINK_IN },
          });
        }
      } else if (node.type === LINK_IN) {
        if (peer.type !== LINK_OUT && peer.type !== LINK_CALL) {
          diagnostics.push({
            severity: 'error',
            rule: RULE,
            message: `Link-in '${node.id}' lists peer '${peerId}' which is type '${peer.type}', expected 'link out' or 'link call'.`,
            nodeId: node.id,
            ...(sourceTab !== undefined ? { tabId: sourceTab } : {}),
            context: { peerId, peerType: peer.type },
          });
        }
      }
    }
  }

  return diagnostics;
}
