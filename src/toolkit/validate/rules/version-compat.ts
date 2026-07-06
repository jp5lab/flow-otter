import type { Capability } from '../../../adapters/nodered/capabilities.js';
import { requirementFor } from '../../../adapters/nodered/capabilities.js';
import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { ValidationRuleContext } from '../index.js';
import type { Diagnostic } from '../report.js';

import { parseFunctionNodeJs } from './_function-ast.js';

export const RULE = 'version-compat';

interface AcornNode {
  type: string;
  [key: string]: unknown;
}

interface FeatureHit {
  readonly node: FlowsJsonNode;
  readonly capability: Capability;
  readonly feature: string;
  readonly detail: string;
  readonly context: Readonly<Record<string, unknown>>;
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

function isNodeLinkcall(callee: AcornNode): boolean {
  if (callee.type !== 'MemberExpression') return false;
  if (callee['computed'] === true) return false;
  const obj = callee['object'] as AcornNode | undefined;
  const prop = callee['property'] as AcornNode | undefined;
  return (
    obj?.type === 'Identifier' &&
    obj['name'] === 'node' &&
    prop?.type === 'Identifier' &&
    prop['name'] === 'linkcall'
  );
}

function hasNodeLinkcall(code: string): boolean {
  const parsed = parseFunctionNodeJs(code);
  if (!parsed.ok) return false;

  let found = false;
  walk(parsed.program as unknown as AcornNode, (n) => {
    if (found || n.type !== 'CallExpression') return;
    const callee = n['callee'] as AcornNode | undefined;
    if (callee && isNodeLinkcall(callee)) found = true;
  });
  return found;
}

function functionLibModules(node: FlowsJsonNode): string[] {
  const libs = (node as { libs?: unknown }).libs;
  if (!Array.isArray(libs)) return [];
  const modules: string[] = [];
  for (const lib of libs) {
    if (lib === null || typeof lib !== 'object') continue;
    const moduleName = (lib as { module?: unknown }).module;
    if (typeof moduleName === 'string' && moduleName.startsWith('node:')) {
      modules.push(moduleName);
    }
  }
  return modules;
}

function hitsForNode(node: FlowsJsonNode): FeatureHit[] {
  const hits: FeatureHit[] = [];

  if (node.type === 'delay' && (node as { pauseType?: unknown }).pauseType === 'burst') {
    hits.push({
      node,
      capability: 'delayBurstMode',
      feature: 'delay.pauseType',
      detail: 'delay burst mode',
      context: { feature: 'delay.pauseType', value: 'burst' },
    });
  }

  if (node.type === 'tls-config') {
    const certType = (node as { certType?: unknown }).certType;
    if (certType === 'pfx') {
      hits.push({
        node,
        capability: 'tlsPfx',
        feature: 'tls-config.certType',
        detail: 'TLS PKCS#12 pfx certificate mode',
        context: { feature: 'tls-config.certType', value: 'pfx' },
      });
    } else if (certType === 'env') {
      hits.push({
        node,
        capability: 'tlsEnvVars',
        feature: 'tls-config.certType',
        detail: 'TLS environment-variable certificate mode',
        context: { feature: 'tls-config.certType', value: 'env' },
      });
    }
  }

  if (node.type === 'function') {
    const prefixedModules = functionLibModules(node);
    if (prefixedModules.length > 0) {
      const moduleName = prefixedModules[0]!;
      hits.push({
        node,
        capability: 'functionNodePrefixModules',
        feature: 'function.libs.module',
        detail: `function external module '${moduleName}'`,
        context: {
          feature: 'function.libs.module',
          module: moduleName,
          modules: prefixedModules,
        },
      });
    }

    const code = (node as { func?: unknown }).func;
    if (typeof code === 'string' && code.length > 0 && hasNodeLinkcall(code)) {
      hits.push({
        node,
        capability: 'functionLinkCall',
        feature: 'function.node.linkcall',
        detail: 'function node.linkcall(...) runtime API',
        context: { feature: 'function.node.linkcall', call: 'node.linkcall' },
      });
    }
  }

  return hits;
}

function diagnosticForHit(hit: FeatureHit, runtimeVersion: string): Diagnostic {
  const requirement = requirementFor(hit.capability);
  const tab = tabId(hit.node);
  return {
    severity: 'warning',
    rule: RULE,
    message: `${hit.detail} requires Node-RED ${requirement} (capability '${hit.capability}'); target runtime is ${runtimeVersion}.`,
    nodeId: hit.node.id,
    ...(tab !== undefined ? { tabId: tab } : {}),
    context: {
      capability: hit.capability,
      requirement,
      runtime_version: runtimeVersion,
      ...hit.context,
    },
  };
}

export function check(flows: FlowsJson, context: ValidationRuleContext = {}): Diagnostic[] {
  const runtime = context.runtime;
  if (runtime === undefined) return [];

  const diagnostics: Diagnostic[] = [];
  for (const node of flows) {
    for (const hit of hitsForNode(node)) {
      if (runtime.capabilities[hit.capability] === false) {
        diagnostics.push(diagnosticForHit(hit, runtime.version));
      }
    }
  }
  return diagnostics;
}
