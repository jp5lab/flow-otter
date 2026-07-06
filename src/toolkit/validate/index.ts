import type { FlowsJson } from '../../shared/flows-json.js';
import type { RuntimeCapabilities } from '../../adapters/nodered/capabilities.js';
import type { NamingContract } from '../naming/schema.js';

import {
  type Diagnostic,
  type DiagnosticSeverity,
  type ValidationReport,
  buildReport,
} from './report.js';
import * as credentialLeak from './rules/credential-leak.js';
import * as dashboard2DestructiveNeedsConfirm from './rules/dashboard-2-destructive-needs-confirm.js';
import * as dashboard2GroupWidthFits from './rules/dashboard-2-group-width-fits.js';
import * as dashboard2Hierarchy from './rules/dashboard-2-hierarchy.js';
import * as dashboard2MixedVersions from './rules/dashboard-2-mixed-versions.js';
import * as dashboard2RequiredFields from './rules/dashboard-2-required-fields.js';
import * as dashboardHierarchy from './rules/dashboard-hierarchy.js';
import * as functionSideEffects from './rules/function-side-effects.js';
import * as functionSyntax from './rules/function-syntax.js';
import * as groupConsistency from './rules/group-consistency.js';
import * as idUniqueness from './rules/id-uniqueness.js';
import * as knownIssues from './rules/known-issues.js';
import * as labelCap from './rules/label-cap.js';
import * as linkResolution from './rules/link-resolution.js';
import * as namingContract from './rules/naming-contract.js';
import * as onGrid from './rules/on-grid.js';
import * as subflowPorts from './rules/subflow-ports.js';
import * as tabDivergence from './rules/tab-divergence.js';
import * as versionCompat from './rules/version-compat.js';
import * as wireTargets from './rules/wire-targets.js';
// ISA-101 enforcement rules added in v1.3.0 (Item 11 of the v1.3.0 plan in docs/DESIGN.md):
import * as buttonGroupColorDecoration from './rules/button-group-color-decoration.js';
import * as saturatedColorOutsideAlarm from './rules/saturated-color-outside-alarm.js';
import * as screenClutter from './rules/screen-clutter.js';
import * as unboundedChartAppend from './rules/unbounded-chart-append.js';

export interface ValidateOptions {
  labelCap?: number;
  grid?: number;
  namingContract?: NamingContract;
  runtime?: RuntimeCapabilities;
}

export interface ValidationRuleContext {
  readonly runtime?: RuntimeCapabilities;
}

type ValidationCheck = (flows: FlowsJson, context: ValidationRuleContext) => Diagnostic[];

function ruleContext(opts: ValidateOptions): ValidationRuleContext {
  return opts.runtime !== undefined ? { runtime: opts.runtime } : {};
}

function invokeCheck(
  check: ValidationCheck,
  flows: FlowsJson,
  context: ValidationRuleContext,
): Diagnostic[] {
  return check(flows, context);
}

function withRuleContext<T extends object>(
  opts: T,
  context: ValidationRuleContext,
): T & ValidationRuleContext {
  if (context.runtime === undefined) return opts;
  return { ...opts, runtime: context.runtime };
}

export function runValidators(flows: FlowsJson, opts: ValidateOptions = {}): ValidationReport {
  const context = ruleContext(opts);
  const diagnostics: Diagnostic[] = [
    ...invokeCheck(idUniqueness.check, flows, context),
    ...invokeCheck(wireTargets.check, flows, context),
    ...labelCap.check(
      flows,
      withRuleContext(opts.labelCap !== undefined ? { cap: opts.labelCap } : {}, context),
    ),
    ...onGrid.check(
      flows,
      withRuleContext(opts.grid !== undefined ? { grid: opts.grid } : {}, context),
    ),
    ...invokeCheck(groupConsistency.check, flows, context),
    ...invokeCheck(functionSyntax.check, flows, context),
    ...invokeCheck(linkResolution.check, flows, context),
    ...invokeCheck(subflowPorts.check, flows, context),
    ...invokeCheck(dashboardHierarchy.check, flows, context),
    ...invokeCheck(dashboard2Hierarchy.check, flows, context),
    ...invokeCheck(dashboard2RequiredFields.check, flows, context),
    ...invokeCheck(dashboard2GroupWidthFits.check, flows, context),
    ...invokeCheck(dashboard2MixedVersions.check, flows, context),
    ...invokeCheck(dashboard2DestructiveNeedsConfirm.check, flows, context),
    ...invokeCheck(tabDivergence.check, flows, context),
    ...namingContract.check(
      flows,
      withRuleContext(
        opts.namingContract !== undefined ? { contract: opts.namingContract } : {},
        context,
      ),
    ),
    ...invokeCheck(credentialLeak.check, flows, context),
    ...invokeCheck(functionSideEffects.check, flows, context),
    ...invokeCheck(versionCompat.check, flows, context),
    ...invokeCheck(knownIssues.check, flows, context),
    // ISA-101 enforcement (Item 11):
    ...invokeCheck(unboundedChartAppend.check, flows, context),
    ...screenClutter.check(
      flows,
      withRuleContext<NonNullable<Parameters<typeof screenClutter.check>[1]>>({}, context),
    ),
    ...invokeCheck(saturatedColorOutsideAlarm.check, flows, context),
    ...invokeCheck(buttonGroupColorDecoration.check, flows, context),
  ];
  return buildReport(diagnostics);
}

export {
  type Diagnostic,
  type ValidationReport,
  type DiagnosticSeverity,
  type RuntimeCapabilities,
};
