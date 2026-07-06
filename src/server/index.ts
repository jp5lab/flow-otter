import { buildContainer, rehydrateFromPersistedTarget } from './container.js';
import { addCatchNodeTool } from './tools/author/add-catch-node.js';
import { addCommentTool } from './tools/author/add-comment.js';
import { addCompleteNodeTool } from './tools/author/add-complete-node.js';
import { addDashboardWidgetTool } from './tools/author/add-dashboard-widget.js';
import { addDebugNodeTool } from './tools/author/add-debug-node.js';
import { addFunctionNodeTool } from './tools/author/add-function-node.js';
import { addGroupTool } from './tools/author/add-group.js';
import { addInjectNodeTool } from './tools/author/add-inject-node.js';
import { addLinkCallNodeTool } from './tools/author/add-link-call-node.js';
import { addLinkInNodeTool } from './tools/author/add-link-in-node.js';
import { addLinkOutNodeTool } from './tools/author/add-link-out-node.js';
import { addMqttInNodeTool } from './tools/author/add-mqtt-in-node.js';
import { addMqttOutNodeTool } from './tools/author/add-mqtt-out-node.js';
import { addNodeTool } from './tools/author/add-node.js';
import { addStatusNodeTool } from './tools/author/add-status-node.js';
import { addSubflowInstanceTool } from './tools/author/add-subflow-instance.js';
import { createSubflowDefinitionTool } from './tools/author/create-subflow-definition.js';
import { discardStagedChangeTool } from './tools/author/discard-staged-change.js';
import { instantiateTemplateTool } from './tools/author/instantiate-template.js';
import { moveNodeTool } from './tools/author/move-node.js';
import { planFlowTool } from './tools/author/plan-flow.js';
import { removeGroupTool } from './tools/author/remove-group.js';
import { removeNodeTool } from './tools/author/remove-node.js';
import { setLinksTool } from './tools/author/set-links.js';
import { setWiresTool } from './tools/author/set-wires.js';
import { stageChangesTool } from './tools/author/stage-changes.js';
import { updateCommentTool } from './tools/author/update-comment.js';
import { updateGroupTool } from './tools/author/update-group.js';
import { updateNodeTool } from './tools/author/update-node.js';
import { wireNodesTool } from './tools/author/wire-nodes.js';
import { createFlowTool } from './tools/dangerous/create-flow.js';
import { deleteFlowTool } from './tools/dangerous/delete-flow.js';
import { deleteTabTool } from './tools/dangerous/delete-tab.js';
import { prepareDangerousOperationTool } from './tools/dangerous/prepare-dangerous-operation.js';
import { replaceFlowsTool } from './tools/dangerous/replace-flows.js';
import { resetRuntimeTool } from './tools/dangerous/reset-runtime.js';
import { updateFlowTool } from './tools/dangerous/update-flow.js';
import { deployStagedChangeTool } from './tools/deploy/deploy-staged-change.js';
import { rollbackLastChangeTool } from './tools/deploy/rollback-last-change.js';
import { setFlowsStateTool } from './tools/deploy/set-flows-state.js';
import { analyzeAllFlowsTool } from './tools/read/analyze-all-flows.js';
import { analyzeFlowTool } from './tools/read/analyze-flow.js';
import { clearTargetTool } from './tools/read/clear-target.js';
import { enableToolsetTool } from './tools/read/enable-toolset.js';
import { explainFlowTool } from './tools/read/explain-flow.js';
import { exportSnapshotTool } from './tools/read/export-snapshot.js';
import { getAuditLogRecentTool } from './tools/read/get-audit-log-recent.js';
import { getAuthoringGuideTool } from './tools/read/get-authoring-guide.js';
import { getFlowTool } from './tools/read/get-flow.js';
import { getRecentDebugMessagesTool } from './tools/read/get-recent-debug-messages.js';
import { getFlowsSummaryTool } from './tools/read/get-flows-summary.js';
import { getNodeTool } from './tools/read/get-node.js';
import { getRuntimeStateTool } from './tools/read/get-runtime-state.js';
import { getServerConfigSummaryTool } from './tools/read/get-server-config-summary.js';
import { getSnapshotTool } from './tools/read/get-snapshot.js';
import { getStagedChangeTool } from './tools/read/get-staged-change.js';
import { getSubflowTool } from './tools/read/get-subflow.js';
import { healthCheckTool } from './tools/read/health-check.js';
import { listAvailableToolsetsTool } from './tools/read/list-available-toolsets.js';
import { listFlowsTool } from './tools/read/list-flows.js';
import { listInstalledNodeTypesTool } from './tools/read/list-installed-node-types.js';
import { listSnapshotsTool } from './tools/read/list-snapshots.js';
import { listTemplatesTool } from './tools/read/list-templates.js';
import { previewFlowDiffTool } from './tools/read/preview-flow-diff.js';
import { renderFlowPngTool } from './tools/read/render-flow-png.js';
import { renderFlowSvgTool } from './tools/read/render-flow-svg.js';
import { searchNodesTool } from './tools/read/search-nodes.js';
import { setTargetTool } from './tools/read/set-target.js';
import { validateAllFlowsTool } from './tools/read/validate-all-flows.js';
import { validateFlowTool } from './tools/read/validate-flow.js';
import { buildRegistry } from './tools/register.js';
import type { Tool } from './tools/_tool.js';
import { startStdio } from './transport/stdio.js';
import { installShutdown } from './transport/shutdown.js';

export const SERVER_INFO = {
  name: 'flow-otter',
  version: '1.3.0',
};

/**
 * Server-level methodology playbook injected into MCP clients that surface
 * `instructions`. Claude Code truncates server instructions at ~2KB; keep
 * under that ceiling. Update via tests/unit/server/instructions.test.ts.
 */
export const SERVER_INSTRUCTIONS = `FlowOtter authors Node-RED flows (4.0+) for AI agents: staging, validation, snapshots, atomic deploys. Author in 4 phases.

1. PLAN — for flows >10 nodes or operator dashboards, call plan_flow. Restate 3-7 stages; decide organization BEFORE nodes.

2. ORGANIZE — decision tree:
- Pattern repeats 2+ times → create_subflow_definition + add_subflow_instance
- Nodes share one purpose → add_group (nestable)
- Wire spans tabs/distance → add_link_out_node + add_link_in_node
- Stage is independent → new tab

3. STRUCTURE → WIRE → LAYOUT:
- Author ops write ONE staged change; pending stage blocks next author op until deploy_staged_change or discard_staged_change. Layout: positions/groups/move_node.
- stage_changes batches many ops into ONE staged change.

LAYOUT CONVENTIONS: 20px grid; stages left-to-right at 140-220px column pitch; error lane ≥120px BELOW the happy path; switch port 0 (affirmative) on top; tab ≤1420px wide (visible viewport); minimize wire crossings; no backward wires. validate_flow returns diagnostics.

4. REVIEW → VALIDATE → DEPLOY:
- render_flow_png(against:'staged') returns png_path — Read it; render_flow_svg for SVG. Show user; validate_flow; get_staged_change gives staged_hash; preview_flow_diff before deploy_staged_change. User confirms.

DISCOVERY: get_authoring_guide returns the catalog (node types, widgets, templates, validators, layout_conventions, ISA-101 principles); list_available_toolsets/enable_toolset unlock more tools.

SPECIALISTS: prefer generic add_node({type, ...}) for contrib + core types; enable author_specialists only when type-specific schemas matter.

DASHBOARDS: Dashboard 2.0 follows ISA-101 — grayscale, color = severity, trends > instantaneous, destructive controls confirm.

VERSIONING: Node-RED version detected on set_target; gated features via health_check.capabilities.

CREDENTIALS: never authored — deploy empty credential fields; the user fills them in the editor. The credential-leak validator catches misplaced secrets.`;

export const ALL_TOOLS: readonly Tool<unknown, unknown>[] = [
  healthCheckTool as unknown as Tool<unknown, unknown>,
  getServerConfigSummaryTool as unknown as Tool<unknown, unknown>,
  setTargetTool as unknown as Tool<unknown, unknown>,
  clearTargetTool as unknown as Tool<unknown, unknown>,
  listFlowsTool as unknown as Tool<unknown, unknown>,
  getFlowsSummaryTool as unknown as Tool<unknown, unknown>,
  getFlowTool as unknown as Tool<unknown, unknown>,
  getNodeTool as unknown as Tool<unknown, unknown>,
  searchNodesTool as unknown as Tool<unknown, unknown>,
  getSubflowTool as unknown as Tool<unknown, unknown>,
  listInstalledNodeTypesTool as unknown as Tool<unknown, unknown>,
  getRuntimeStateTool as unknown as Tool<unknown, unknown>,
  explainFlowTool as unknown as Tool<unknown, unknown>,
  analyzeFlowTool as unknown as Tool<unknown, unknown>,
  analyzeAllFlowsTool as unknown as Tool<unknown, unknown>,
  validateFlowTool as unknown as Tool<unknown, unknown>,
  validateAllFlowsTool as unknown as Tool<unknown, unknown>,
  renderFlowSvgTool as unknown as Tool<unknown, unknown>,
  renderFlowPngTool as unknown as Tool<unknown, unknown>,
  previewFlowDiffTool as unknown as Tool<unknown, unknown>,
  exportSnapshotTool as unknown as Tool<unknown, unknown>,
  listSnapshotsTool as unknown as Tool<unknown, unknown>,
  getSnapshotTool as unknown as Tool<unknown, unknown>,
  listTemplatesTool as unknown as Tool<unknown, unknown>,
  getStagedChangeTool as unknown as Tool<unknown, unknown>,
  getAuditLogRecentTool as unknown as Tool<unknown, unknown>,
  getRecentDebugMessagesTool as unknown as Tool<unknown, unknown>,
  getAuthoringGuideTool as unknown as Tool<unknown, unknown>,
  listAvailableToolsetsTool as unknown as Tool<unknown, unknown>,
  enableToolsetTool as unknown as Tool<unknown, unknown>,
  addDebugNodeTool as unknown as Tool<unknown, unknown>,
  addInjectNodeTool as unknown as Tool<unknown, unknown>,
  addFunctionNodeTool as unknown as Tool<unknown, unknown>,
  addCatchNodeTool as unknown as Tool<unknown, unknown>,
  addStatusNodeTool as unknown as Tool<unknown, unknown>,
  addCompleteNodeTool as unknown as Tool<unknown, unknown>,
  addMqttInNodeTool as unknown as Tool<unknown, unknown>,
  addMqttOutNodeTool as unknown as Tool<unknown, unknown>,
  addLinkInNodeTool as unknown as Tool<unknown, unknown>,
  addLinkOutNodeTool as unknown as Tool<unknown, unknown>,
  addLinkCallNodeTool as unknown as Tool<unknown, unknown>,
  addSubflowInstanceTool as unknown as Tool<unknown, unknown>,
  addGroupTool as unknown as Tool<unknown, unknown>,
  addCommentTool as unknown as Tool<unknown, unknown>,
  addNodeTool as unknown as Tool<unknown, unknown>,
  addDashboardWidgetTool as unknown as Tool<unknown, unknown>,
  wireNodesTool as unknown as Tool<unknown, unknown>,
  setLinksTool as unknown as Tool<unknown, unknown>,
  setWiresTool as unknown as Tool<unknown, unknown>,
  stageChangesTool as unknown as Tool<unknown, unknown>,
  removeNodeTool as unknown as Tool<unknown, unknown>,
  updateNodeTool as unknown as Tool<unknown, unknown>,
  moveNodeTool as unknown as Tool<unknown, unknown>,
  updateGroupTool as unknown as Tool<unknown, unknown>,
  removeGroupTool as unknown as Tool<unknown, unknown>,
  updateCommentTool as unknown as Tool<unknown, unknown>,
  createSubflowDefinitionTool as unknown as Tool<unknown, unknown>,
  discardStagedChangeTool as unknown as Tool<unknown, unknown>,
  instantiateTemplateTool as unknown as Tool<unknown, unknown>,
  planFlowTool as unknown as Tool<unknown, unknown>,
  deployStagedChangeTool as unknown as Tool<unknown, unknown>,
  rollbackLastChangeTool as unknown as Tool<unknown, unknown>,
  setFlowsStateTool as unknown as Tool<unknown, unknown>,
  prepareDangerousOperationTool as unknown as Tool<unknown, unknown>,
  replaceFlowsTool as unknown as Tool<unknown, unknown>,
  deleteTabTool as unknown as Tool<unknown, unknown>,
  resetRuntimeTool as unknown as Tool<unknown, unknown>,
  createFlowTool as unknown as Tool<unknown, unknown>,
  updateFlowTool as unknown as Tool<unknown, unknown>,
  deleteFlowTool as unknown as Tool<unknown, unknown>,
];

export async function startServer(): Promise<void> {
  const container = buildContainer({ serverVersion: SERVER_INFO.version });

  const rehydration = await rehydrateFromPersistedTarget(container);
  for (const w of rehydration.warnings) {
    container.logger.warn({ ...w }, 'persisted target.json ignored');
  }
  if (rehydration.rehydrated && rehydration.applied) {
    container.logger.info(
      {
        flow_source: rehydration.applied.flow_source,
        env_name: rehydration.applied.env_name,
        target: rehydration.applied.base_url ?? rehydration.applied.file_path ?? '<unset>',
      },
      'rehydrated target from persisted target.json',
    );
  } else if (rehydration.skipped_because) {
    container.logger.debug(
      { reason: rehydration.skipped_because },
      'persisted-target rehydration skipped',
    );
  }

  container.logger.info(
    {
      flowSource: container.flowSource.describe(),
      readOnly: container.config.READ_ONLY_MODE,
      writeEnabled: container.config.ENABLE_WRITE_TOOLS,
      deployEnabled: container.config.ENABLE_DEPLOY_TOOLS,
    },
    'starting flow-otter',
  );
  const registry = buildRegistry(container, ALL_TOOLS);
  // Attach the registry to the typed Container slot so toolset-management
  // tools can mutate enabled state. See container.ts:Container.toolRegistry.
  container.toolRegistry = registry;
  const { shutdown } = await startStdio({
    container,
    registry,
    serverInfo: SERVER_INFO,
    instructions: SERVER_INSTRUCTIONS,
  });

  installShutdown(async () => {
    container.logger.info('shutting down');
    try {
      container.comms?.dispose();
    } catch (err) {
      container.logger.warn({ err: String(err) }, 'comms.dispose() failed during shutdown');
    }
    try {
      await container.auth.revoke();
    } catch (err) {
      container.logger.warn({ err: String(err) }, 'auth.revoke() failed during shutdown');
    }
    await shutdown();
  });

  container.logger.info(
    { tools: registry.listTools().map((t) => t.name) },
    'mcp server ready (stdio)',
  );
}
