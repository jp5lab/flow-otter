/**
 * Build a NudgeContext from the live container state. Cheap I/O (reads
 * staging files); called at most once per tool invocation that has matching
 * nudges. Defensive: any read failure produces a "best-effort" context with
 * empty fields rather than throwing.
 */

import { readPlan } from '../../toolkit/staging/plan-record.js';
import type { Container } from '../container.js';

import type { NudgeContext, NudgeFlowInfo, NudgeStagingInfo } from './types.js';

async function safeReadStaging(container: Container): Promise<NudgeStagingInfo> {
  let stagedNodeCount = 0;
  let stagedHash: string | undefined;
  try {
    const staged = await container.staging.read();
    if (staged !== null) {
      stagedNodeCount = staged.flows.length;
      stagedHash = staged.stagedHash;
    }
  } catch (err) {
    // best-effort: a missing staging dir is normal pre-first-edit. Surface
    // *other* failures (permission errors, malformed staged.json) at debug
    // so they're discoverable without breaking the tool call.
    container.logger.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'nudge-context: staging.read() failed (best-effort)',
    );
  }
  let hasPlan = false;
  let planId: string | undefined;
  try {
    const plan = await readPlan(container.config.STAGING_DIR);
    if (plan !== null) {
      hasPlan = true;
      planId = plan.plan_id;
    }
  } catch (err) {
    container.logger.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'nudge-context: readPlan() failed (best-effort)',
    );
  }
  return {
    node_count: stagedNodeCount,
    has_plan: hasPlan,
    ...(planId !== undefined ? { plan_id: planId } : {}),
    ...(stagedHash !== undefined ? { staged_hash: stagedHash } : {}),
  };
}

async function safeReadFlowInfo(container: Container): Promise<NudgeFlowInfo> {
  let hasDashboardV1 = false;
  let hasDashboardV2 = false;
  try {
    const staged = await container.staging.read();
    if (staged !== null) {
      for (const node of staged.flows) {
        if (typeof node.type !== 'string') continue;
        if (node.type === 'ui_base' || node.type.startsWith('ui_')) hasDashboardV1 = true;
        if (node.type === 'ui-base' || node.type.startsWith('ui-')) hasDashboardV2 = true;
      }
    }
  } catch (err) {
    container.logger.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'nudge-context: dashboard-version detection read failed (best-effort)',
    );
  }
  return {
    has_dashboard_v1: hasDashboardV1,
    has_dashboard_v2: hasDashboardV2,
  };
}

export async function buildNudgeContext(
  container: Container,
  toolName: string,
  tier: string,
): Promise<NudgeContext> {
  const [staging, flow] = await Promise.all([
    safeReadStaging(container),
    safeReadFlowInfo(container),
  ]);
  return { tool_name: toolName, tier, staging, flow };
}
