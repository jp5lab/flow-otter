import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

import { CREDENTIAL_PATTERNS, type CredentialPattern } from './_credential-patterns.js';

export const RULE = 'credential-leak';

function tabId(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function* walkStrings(
  value: unknown,
  pathPrefix: string,
): Generator<{ path: string; value: string }, void, void> {
  if (typeof value === 'string') {
    yield { path: pathPrefix, value };
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* walkStrings(value[i], `${pathPrefix}[${i}]`);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      yield* walkStrings(v, pathPrefix === '' ? k : `${pathPrefix}.${k}`);
    }
  }
}

function previewMatch(match: RegExpMatchArray): string {
  const m = match[0];
  if (m.length <= 16) return `${m.slice(0, 4)}…${m.slice(-2)}`;
  return `${m.slice(0, 6)}…${m.slice(-2)}`;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const node of flows) {
    for (const { path, value } of walkStrings(node, '')) {
      // Skip the id field; ids are intentionally hex-shaped.
      if (path === 'id') continue;
      // Skip the AUTHORING_KEY_FIELD if present (also hex-shaped sometimes).
      if (path === '_authoringKey') continue;
      for (const pattern of CREDENTIAL_PATTERNS) {
        const m = value.match(pattern.regex);
        if (!m) continue;
        diagnostics.push({
          severity: pattern.severity,
          rule: RULE,
          message: `Possible credential (${pattern.name}) at ${path} on node '${node.id}': ${previewMatch(m)}`,
          nodeId: node.id,
          ...(tabId(node) !== undefined ? { tabId: tabId(node)! } : {}),
          context: { pattern: pattern.name, field: path },
        });
      }
    }
  }

  return diagnostics;
}

export type { CredentialPattern };
