import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'dashboard-2-destructive-needs-confirm';

/**
 * Vocabulary of destructive payload verbs. Conservative: matches the *exact*
 * payload value (after lowercasing). If a designer wants a "stop bell"
 * non-critical action they can pick a different payload word.
 *
 * Standards anchor: ISA-18.2 §11.13 "operator confirmable actions" — any
 * control that can damage equipment or injure operators requires a second
 * intentional action (two-step / hold / password) before firing.
 */
const DESTRUCTIVE_PAYLOADS = new Set([
  'abort',
  'stop',
  'estop',
  'e-stop',
  'emergency-stop',
  'emergencystop',
  'shutdown',
  'reset',
  'trip',
  'kill',
  'halt',
]);

const DESTRUCTIVE_LABEL_PATTERNS = [
  /\babort\b/i,
  /\bemergency\s*stop\b/i,
  /\be[- ]?stop\b/i,
  /\bshutdown\b/i,
  /\bkill\b/i,
];

function tabIdOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function groupOf(node: FlowsJsonNode): string | undefined {
  const g = (node as { group?: unknown }).group;
  return typeof g === 'string' ? g : undefined;
}

function isV2ButtonOrButtonGroup(type: string): boolean {
  return type === 'ui-button' || type === 'ui-button-group';
}

function lowerString(v: unknown): string | undefined {
  return typeof v === 'string' ? v.toLowerCase().trim() : undefined;
}

/**
 * Extract candidate payload strings from a ui-button or ui-button-group node.
 * - `ui-button`: single `payload` field (when payloadType is 'str').
 * - `ui-button-group`: `options[]` array of `{label, value}` or `{label, payload}`.
 */
function destructivePayloadsIn(node: FlowsJsonNode): readonly string[] {
  const out: string[] = [];
  const n = node as Record<string, unknown>;
  // Single-button shape.
  const singlePayload = lowerString(n['payload']);
  if (singlePayload && DESTRUCTIVE_PAYLOADS.has(singlePayload)) out.push(singlePayload);
  // Button-group options[].
  const options = n['options'];
  if (Array.isArray(options)) {
    for (const opt of options) {
      if (opt === null || typeof opt !== 'object') continue;
      const v = lowerString((opt as Record<string, unknown>)['value']);
      if (v && DESTRUCTIVE_PAYLOADS.has(v)) out.push(v);
      const p = lowerString((opt as Record<string, unknown>)['payload']);
      if (p && DESTRUCTIVE_PAYLOADS.has(p)) out.push(p);
    }
  }
  // Label heuristic — flags Abort/Shutdown/E-Stop labels even without matching payload word.
  const label = n['label'] ?? n['name'];
  if (typeof label === 'string') {
    for (const pat of DESTRUCTIVE_LABEL_PATTERNS) {
      if (pat.test(label)) {
        out.push(label.toLowerCase());
        break;
      }
    }
  }
  return Array.from(new Set(out));
}

/**
 * Does the same group contain at least one ui-template (assumed confirm-button
 * widget) or a follow-up node that signals an explicit confirmation step?
 * Heuristic: presence of a `ui-template` in the same group OR a node with
 * `_authoringKey` containing 'confirm' is treated as confirmation pairing.
 */
function groupHasConfirmation(flows: FlowsJson, groupId: string): boolean {
  for (const node of flows) {
    if (groupOf(node) !== groupId) continue;
    if (node.type === 'ui-template') return true;
    const ak = (node as Record<string, unknown>)['_authoringKey'];
    if (typeof ak === 'string' && /confirm/i.test(ak)) return true;
  }
  return false;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const node of flows) {
    if (typeof node.type !== 'string' || !isV2ButtonOrButtonGroup(node.type)) continue;
    const dPayloads = destructivePayloadsIn(node);
    if (dPayloads.length === 0) continue;

    const groupId = groupOf(node);
    if (groupId && groupHasConfirmation(flows, groupId)) continue;

    const z = tabIdOf(node);
    diagnostics.push({
      severity: 'warning',
      rule: RULE,
      message: `Dashboard 2.0 ${node.type} '${node.id}' fires destructive payload(s) [${dPayloads.join(', ')}] with no confirmation widget in the same group. Per ISA-18.2 §11.13, destructive actions should require a second intentional step (use the dashboard_2_confirmed_button template or a ui-template hold-to-confirm widget in the same ui-group).`,
      nodeId: node.id,
      ...(z !== undefined ? { tabId: z } : {}),
      context: {
        destructive_payloads: dPayloads,
        ...(groupId !== undefined ? { groupId } : {}),
      },
    });
  }

  return diagnostics;
}
