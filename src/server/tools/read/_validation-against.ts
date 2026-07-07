import { isTab, type FlowsJson } from '../../../shared/flows-json.js';
import { ValidationFailedError, type ToolContext } from '../_tool.js';

export type Against = 'staged' | 'runtime';

export interface ValidationSource {
  flows: FlowsJson;
  rev: string | null;
  against: Against;
  stagedHash: string | null;
  basedOnSnapshotHash: string | null;
}

export async function loadValidationSource(
  ctx: ToolContext,
  against: Against,
  toolName: string,
): Promise<ValidationSource> {
  if (against === 'staged') {
    const staged = await ctx.staging.read();
    if (!staged) {
      throw new ValidationFailedError(
        `No staged change to validate. Stage a change with an author tool first, or call ${toolName} with against:'runtime' (the default) to validate the deployed flows.`,
        [
          {
            severity: 'error',
            rule: 'staging/no-staged-change',
            message: `${toolName}(against:'staged') requires a pending staged change, but the staging slot is empty. Use get_staged_change to inspect staging state.`,
          },
        ],
      );
    }
    return {
      flows: staged.flows,
      // The runtime rev the staged change was computed against — the same
      // provenance get_staged_change reports as based_on_rev.
      rev: staged.basedOnRev,
      against,
      stagedHash: staged.stagedHash,
      basedOnSnapshotHash: staged.basedOnSnapshotHash,
    };
  }

  const { flows, rev } = await ctx.flowSource.load();
  return {
    flows,
    rev,
    against,
    stagedHash: null,
    basedOnSnapshotHash: null,
  };
}

export function resolveTabNodeRedId(
  flows: FlowsJson,
  tabIdOrKey: string,
  opts: { acceptAuthoringKey: boolean },
): string | undefined {
  for (const node of flows) {
    if (!isTab(node)) continue;
    const ext = (node as Record<string, unknown>)['_authoringKey'];
    const authoringKey = typeof ext === 'string' ? ext : node.id;
    if (node.id === tabIdOrKey || (opts.acceptAuthoringKey && authoringKey === tabIdOrKey)) {
      return node.id;
    }
  }
  return undefined;
}
