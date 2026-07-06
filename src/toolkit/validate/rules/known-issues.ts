import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { ValidationRuleContext } from '../index.js';
import type { Diagnostic } from '../report.js';

import { hasRedUtilGetSettingCall } from './_function-ast.js';

export const RULE = 'known-issues';

interface KnownIssueDetection {
  readonly feature: string;
}

interface KnownIssue {
  readonly id: string;
  readonly title: string;
  readonly affectedVersions: readonly string[];
  readonly upstreamReference: string;
  readonly fixedIn: string | null;
  readonly detector: (node: FlowsJsonNode) => KnownIssueDetection | null;
}

const GET_SETTING_AFFECTED_VERSIONS = ['5.0.0-beta.6', '5.0.0', '5.0.1'] as const;

function tabId(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function detectRedUtilGetSetting(node: FlowsJsonNode): KnownIssueDetection | null {
  if (node.type !== 'function') return null;

  const code = (node as { func?: unknown }).func;
  if (typeof code !== 'string' || code.length === 0) return null;
  if (!hasRedUtilGetSettingCall(code)) return null;

  return { feature: 'function.RED.util.getSetting' };
}

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    id: 'node-red-function-red-util-getsetting-undefined',
    title: 'RED.util.getSetting returns undefined in the Node-RED 5.0 function sandbox',
    affectedVersions: GET_SETTING_AFFECTED_VERSIONS,
    upstreamReference:
      'node-red/node-red 10-function.js sandbox getSetting wrapper regression, introduced 5.0.0-beta.6; no fix release as of 2026-07-06',
    fixedIn: null,
    detector: detectRedUtilGetSetting,
  },
];

function isAffected(issue: KnownIssue, runtimeVersion: string): boolean {
  return issue.affectedVersions.includes(runtimeVersion);
}

function diagnosticForIssue(
  node: FlowsJsonNode,
  issue: KnownIssue,
  hit: KnownIssueDetection,
  runtimeVersion: string,
): Diagnostic {
  const tab = tabId(node);
  return {
    severity: 'warning',
    rule: RULE,
    message: `${issue.title}: RED.util.getSetting(...) silently returns undefined in the affected Node-RED function sandbox for runtime ${runtimeVersion}; use env.get(...) as the workaround.`,
    nodeId: node.id,
    ...(tab !== undefined ? { tabId: tab } : {}),
    context: {
      issue: issue.id,
      affected_versions: issue.affectedVersions,
      runtime_version: runtimeVersion,
      feature: hit.feature,
    },
  };
}

export function check(flows: FlowsJson, context: ValidationRuleContext = {}): Diagnostic[] {
  const runtime = context.runtime;
  if (runtime === undefined) return [];

  const diagnostics: Diagnostic[] = [];
  for (const node of flows) {
    for (const issue of KNOWN_ISSUES) {
      if (!isAffected(issue, runtime.version)) continue;

      const hit = issue.detector(node);
      if (hit === null) continue;

      diagnostics.push(diagnosticForIssue(node, issue, hit, runtime.version));
    }
  }

  return diagnostics;
}
