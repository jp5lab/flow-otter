/**
 * ISA-101 grayscale-90% rule: saturated colors are signal (severity /
 * alarm), not decoration. Operator-screen widgets that hardcode saturated
 * color values *outside* alarm-context fields drift from this principle.
 *
 * Heuristic:
 *  - Detects color hex values with HSL saturation > 0.6 in widget fields
 *    typically used for fill (`color`, `buttonColor`, `iconColor`, `fill`).
 *  - Does NOT flag colors set on `class`, `severity`, `alarm`, or known
 *    alarm-context paths.
 *  - Does NOT flag the standard alarm palette (red/orange/yellow/amber/
 *    magenta) when paired with an alarm-like topic or label.
 *
 * Severity: warning (not error). The rule is advisory — operators can opt
 * into branded colors for non-alarm UIs, but FlowOtter surfaces the
 * deviation.
 */

import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'saturated-color-outside-alarm';

const COLOR_FIELDS = ['color', 'buttonColor', 'iconColor', 'fill', 'backgroundColor'] as const;
const ALARM_FIELDS = ['class', 'classList', 'severity', 'alarmClass'];

function tabIdOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function isDashboard2Widget(type: string): boolean {
  if (!type.startsWith('ui-')) return false;
  return type !== 'ui-base' && type !== 'ui-page' && type !== 'ui-group' && type !== 'ui-theme';
}

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

/**
 * Parse hex color → HSL saturation [0, 1]. Returns null for non-hex inputs.
 */
function hexSaturation(hex: string): number | null {
  let r: number, g: number, b: number;
  let m = HEX6.exec(hex);
  if (m) {
    r = parseInt(m[1]!.slice(0, 2), 16) / 255;
    g = parseInt(m[1]!.slice(2, 4), 16) / 255;
    b = parseInt(m[1]!.slice(4, 6), 16) / 255;
  } else {
    m = HEX3.exec(hex);
    if (m) {
      r = parseInt(m[1]![0]! + m[1]![0]!, 16) / 255;
      g = parseInt(m[1]![1]! + m[1]![1]!, 16) / 255;
      b = parseInt(m[1]![2]! + m[1]![2]!, 16) / 255;
    } else {
      return null;
    }
  }
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function looksLikeAlarmContext(node: FlowsJsonNode): boolean {
  const n = node as Record<string, unknown>;
  for (const field of ALARM_FIELDS) {
    const v = n[field];
    if (typeof v === 'string' && /alarm|severity|critical|warn|fault|error/i.test(v)) return true;
  }
  const topic = n['topic'];
  if (typeof topic === 'string' && /alarm|alert|fault|trip/i.test(topic)) return true;
  const label = n['label'] ?? n['name'];
  if (typeof label === 'string' && /alarm|alert|fault|trip|emergency/i.test(label)) return true;
  return false;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const node of flows) {
    if (typeof node.type !== 'string' || !isDashboard2Widget(node.type)) continue;
    if (looksLikeAlarmContext(node)) continue;

    const n = node as Record<string, unknown>;
    for (const field of COLOR_FIELDS) {
      const v = n[field];
      if (typeof v !== 'string') continue;
      const sat = hexSaturation(v);
      if (sat === null || sat <= 0.6) continue;
      out.push({
        severity: 'warning',
        rule: RULE,
        message: `Dashboard 2.0 ${node.type} '${node.id}' sets ${field}='${v}' (HSL saturation ~${sat.toFixed(2)}) outside an alarm context. ISA-101 grayscale-90% reserves saturation for severity/alarm signal; consider a neutral color or set an alarmClass.`,
        nodeId: node.id,
        ...(tabIdOf(node) !== undefined ? { tabId: tabIdOf(node)! } : {}),
        context: { field, value: v, saturation: sat },
      });
      break; // one diagnostic per node — don't drown the output
    }
  }
  return out;
}
