import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

import { parseFunctionNodeJs } from './_function-ast.js';

export const RULE = 'function-side-effects';

const TIMER_NAMES = new Set(['setInterval', 'setTimeout']);
const NETWORK_MODULES = new Set(['http', 'https', 'net', 'dgram']);
const FS_WRITE_METHODS = new Set([
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'createWriteStream',
  'unlink',
  'unlinkSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
]);

interface Hit {
  readonly kind: string;
  readonly detail: string;
}

interface AcornNode {
  type: string;
  [key: string]: unknown;
}

function tabId(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function walk(node: AcornNode, visit: (n: AcornNode) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const v = (node as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== null && typeof item === 'object' && 'type' in (item as object)) {
          walk(item as AcornNode, visit);
        }
      }
    } else if (v !== null && typeof v === 'object' && 'type' in v) {
      walk(v as AcornNode, visit);
    }
  }
}

function memberName(expr: AcornNode): string | null {
  if (expr.type !== 'MemberExpression') return null;
  const obj = expr['object'] as AcornNode | undefined;
  const prop = expr['property'] as AcornNode | undefined;
  if (!obj || !prop) return null;
  const objName = obj.type === 'Identifier' ? (obj['name'] as string) : null;
  const propName = prop.type === 'Identifier' ? (prop['name'] as string) : null;
  if (objName === null || propName === null) return null;
  return `${objName}.${propName}`;
}

function detectHits(program: AcornNode): Hit[] {
  const hits: Hit[] = [];

  walk(program, (n) => {
    if (n.type === 'CallExpression') {
      const callee = n['callee'] as AcornNode | undefined;
      if (!callee) return;

      if (callee.type === 'Identifier') {
        const name = callee['name'] as string;
        if (TIMER_NAMES.has(name)) {
          hits.push({ kind: 'timer', detail: name });
        }
        if (name === 'require') {
          const args = (n['arguments'] as AcornNode[] | undefined) ?? [];
          const first = args[0];
          if (first && first.type === 'Literal') {
            const v = first['value'];
            if (typeof v === 'string' && NETWORK_MODULES.has(v)) {
              hits.push({ kind: 'network-require', detail: v });
            }
          }
        }
      }

      if (callee.type === 'MemberExpression') {
        const name = memberName(callee);
        if (name === 'process.exit') {
          hits.push({ kind: 'process-exit', detail: 'process.exit' });
        } else if (name !== null) {
          const [obj, method] = name.split('.');
          if (obj === 'fs' && method !== undefined && FS_WRITE_METHODS.has(method)) {
            hits.push({ kind: 'fs-write', detail: name });
          }
          if (obj === 'child_process') {
            hits.push({ kind: 'child-process', detail: name });
          }
        }
      }
    }

    if (n.type === 'NewExpression') {
      const callee = n['callee'] as AcornNode | undefined;
      if (callee && callee.type === 'Identifier' && callee['name'] === 'Function') {
        hits.push({ kind: 'new-function', detail: 'new Function(...)' });
      }
    }
  });

  return hits;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const node of flows) {
    if (node.type !== 'function') continue;
    const code = (node as { func?: unknown }).func;
    if (typeof code !== 'string' || code.length === 0) continue;
    const parsed = parseFunctionNodeJs(code);
    if (!parsed.ok) continue; // syntax errors handled by function-syntax rule

    const hits = detectHits(parsed.program as unknown as AcornNode);
    for (const hit of hits) {
      diagnostics.push({
        severity: 'warning',
        rule: RULE,
        message: `Function node '${node.id}' has potential side effect: ${hit.detail} (${hit.kind}).`,
        nodeId: node.id,
        ...(tabId(node) !== undefined ? { tabId: tabId(node)! } : {}),
        context: { kind: hit.kind, detail: hit.detail },
      });
    }
  }

  return diagnostics;
}
