import { Parser } from 'acorn';
import type { Program } from 'acorn';

export interface ParseFailure {
  readonly ok: false;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ParseSuccess {
  readonly ok: true;
  readonly program: Program;
}

export type ParseResult = ParseSuccess | ParseFailure;

interface AcornNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

function isAcornNode(value: unknown): value is AcornNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function walk(node: AcornNode, visit: (n: AcornNode) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (isUnknownArray(value)) {
      for (const item of value) {
        if (isAcornNode(item)) walk(item, visit);
      }
    } else if (isAcornNode(value)) {
      walk(value, visit);
    }
  }
}

function isNodeLinkCallCallee(node: AcornNode): boolean {
  if (node.type !== 'MemberExpression') return false;
  if (node['computed'] === true) return false;

  const object = node['object'];
  const property = node['property'];
  if (!isAcornNode(object) || !isAcornNode(property)) return false;

  return (
    object.type === 'Identifier' &&
    object['name'] === 'node' &&
    property.type === 'Identifier' &&
    property['name'] === 'linkcall'
  );
}

function stringLiteralValue(node: AcornNode): string | undefined {
  if (node.type !== 'Literal') return undefined;
  const value = node['value'];
  return typeof value === 'string' ? value : undefined;
}

export function parseFunctionNodeJs(code: string): ParseResult {
  try {
    const program = Parser.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      locations: true,
    });
    return { ok: true, program };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const loc = err as { loc?: { line?: number; column?: number } };
    const line = loc.loc?.line;
    const column = loc.loc?.column;
    return {
      ok: false,
      message,
      ...(typeof line === 'number' ? { line } : {}),
      ...(typeof column === 'number' ? { column } : {}),
    };
  }
}

export function findLinkCallTargets(code: string): string[] {
  const parsed = parseFunctionNodeJs(code);
  if (!parsed.ok) return [];

  const targets: string[] = [];
  const seen = new Set<string>();

  walk(parsed.program as unknown as AcornNode, (node) => {
    if (node.type !== 'CallExpression') return;

    const callee = node['callee'];
    if (!isAcornNode(callee) || !isNodeLinkCallCallee(callee)) return;

    const args = node['arguments'];
    if (!isUnknownArray(args)) return;
    const first = args[0];
    if (!isAcornNode(first)) return;

    const target = stringLiteralValue(first);
    if (target === undefined || seen.has(target)) return;
    seen.add(target);
    targets.push(target);
  });

  return targets;
}
