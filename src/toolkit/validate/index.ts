import type { FlowsJson } from '../../shared/flows-json.js';
import type { NamingContract } from '../naming/schema.js';

import { type Diagnostic, type ValidationReport, buildReport } from './report.js';
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
import * as labelCap from './rules/label-cap.js';
import * as linkResolution from './rules/link-resolution.js';
import * as namingContract from './rules/naming-contract.js';
import * as onGrid from './rules/on-grid.js';
import * as subflowPorts from './rules/subflow-ports.js';
import * as tabDivergence from './rules/tab-divergence.js';
import * as wireTargets from './rules/wire-targets.js';

export interface ValidateOptions {
  labelCap?: number;
  grid?: number;
  namingContract?: NamingContract;
}

export function runValidators(flows: FlowsJson, opts: ValidateOptions = {}): ValidationReport {
  const diagnostics: Diagnostic[] = [
    ...idUniqueness.check(flows),
    ...wireTargets.check(flows),
    ...labelCap.check(flows, opts.labelCap !== undefined ? { cap: opts.labelCap } : {}),
    ...onGrid.check(flows, opts.grid !== undefined ? { grid: opts.grid } : {}),
    ...groupConsistency.check(flows),
    ...functionSyntax.check(flows),
    ...linkResolution.check(flows),
    ...subflowPorts.check(flows),
    ...dashboardHierarchy.check(flows),
    ...dashboard2Hierarchy.check(flows),
    ...dashboard2RequiredFields.check(flows),
    ...dashboard2GroupWidthFits.check(flows),
    ...dashboard2MixedVersions.check(flows),
    ...dashboard2DestructiveNeedsConfirm.check(flows),
    ...tabDivergence.check(flows),
    ...namingContract.check(
      flows,
      opts.namingContract !== undefined ? { contract: opts.namingContract } : {},
    ),
    ...credentialLeak.check(flows),
    ...functionSideEffects.check(flows),
  ];
  return buildReport(diagnostics);
}

export { type Diagnostic, type ValidationReport, type DiagnosticSeverity } from './report.js';
