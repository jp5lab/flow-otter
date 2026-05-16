import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { NamingContract } from '../../naming/schema.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'naming-contract';

export const FORBIDDEN_LABEL_SUBSTRINGS: readonly string[] = Object.freeze([
  'TODO',
  'XXX',
  'FIXME',
  'TEST',
]);

interface Options {
  contract?: NamingContract;
}

interface TypeRule {
  pattern?: RegExp;
  maxLen?: number;
  required?: readonly string[];
}

function nodeLabel(node: FlowsJsonNode): string | undefined {
  if ('label' in node && typeof node.label === 'string') return node.label;
  if ('name' in node && typeof node.name === 'string') return node.name;
  return undefined;
}

export function check(flows: FlowsJson, opts: Options = {}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (opts.contract === undefined) {
    for (const node of flows) {
      const label = nodeLabel(node);
      if (label === undefined) continue;
      for (const banned of FORBIDDEN_LABEL_SUBSTRINGS) {
        if (label.includes(banned)) {
          const z = (node as { z?: unknown }).z;
          diagnostics.push({
            severity: 'warning',
            rule: RULE,
            message: `Label '${label}' on node '${node.id}' contains forbidden substring '${banned}'.`,
            nodeId: node.id,
            ...(typeof z === 'string' ? { tabId: z } : {}),
            context: { substring: banned, label },
          });
        }
      }
    }
    return diagnostics;
  }

  const contract = opts.contract;
  const forbiddenRe =
    contract.forbiddenLabelChars !== undefined
      ? new RegExp(contract.forbiddenLabelChars)
      : undefined;

  const typeRules = new Map<string, TypeRule>();
  if (contract.types !== undefined) {
    for (const [typeName, spec] of Object.entries(contract.types)) {
      const rule: TypeRule = {};
      if (spec.labelPattern !== undefined) rule.pattern = new RegExp(spec.labelPattern);
      if (spec.labelMaxLen !== undefined) rule.maxLen = spec.labelMaxLen;
      if (spec.requiredFields !== undefined) rule.required = spec.requiredFields;
      typeRules.set(typeName, rule);
    }
  }

  for (const node of flows) {
    if (node.type === 'comment') continue;
    const z = (node as { z?: unknown }).z;
    const tabIdPart = typeof z === 'string' ? { tabId: z } : {};
    const label = nodeLabel(node);

    if (label !== undefined && forbiddenRe !== undefined) {
      const m = forbiddenRe.exec(label);
      if (m !== null) {
        diagnostics.push({
          severity: 'warning',
          rule: RULE,
          message: `Label '${label}' on node '${node.id}' contains forbidden character '${m[0]}'.`,
          nodeId: node.id,
          ...tabIdPart,
          context: { match: m[0], label, source: 'forbiddenLabelChars' },
        });
      }
    }

    const typeRule = typeRules.get(node.type);
    if (typeRule === undefined) continue;

    if (label !== undefined && typeRule.pattern !== undefined && !typeRule.pattern.test(label)) {
      diagnostics.push({
        severity: 'warning',
        rule: RULE,
        message: `Label '${label}' on node '${node.id}' does not match required pattern '${typeRule.pattern.source}'.`,
        nodeId: node.id,
        ...tabIdPart,
        context: { pattern: typeRule.pattern.source, label, source: 'labelPattern' },
      });
    }

    if (label !== undefined && typeRule.maxLen !== undefined && label.length > typeRule.maxLen) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Label '${label}' on node '${node.id}' exceeds ${typeRule.maxLen}-character cap (${label.length}).`,
        nodeId: node.id,
        ...tabIdPart,
        context: { length: label.length, max: typeRule.maxLen, source: 'labelMaxLen' },
      });
    }

    if (typeRule.required !== undefined) {
      const record = node as Record<string, unknown>;
      for (const fieldName of typeRule.required) {
        const value = record[fieldName];
        if (typeof value !== 'string' || value.length === 0) {
          diagnostics.push({
            severity: 'error',
            rule: RULE,
            message: `Node '${node.id}' is missing required field '${fieldName}'.`,
            nodeId: node.id,
            ...tabIdPart,
            context: { field: fieldName, source: 'requiredFields' },
          });
        }
      }
    }
  }

  return diagnostics;
}
