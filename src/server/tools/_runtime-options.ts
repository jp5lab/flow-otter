import {
  runtimeCapabilitiesFromInfo,
  type RuntimeCapabilities,
} from '../../adapters/nodered/capabilities.js';
import { getOrProbeRuntimeInfo } from '../runtime-info.js';

import type { ToolContext } from './_tool.js';

/**
 * Runtime context for validation/lint rules. File-source targets have no live
 * runtime to probe, so they intentionally return undefined and preserve
 * offline behavior.
 */
export async function runtimeCapabilitiesForTool(
  ctx: ToolContext,
): Promise<RuntimeCapabilities | undefined> {
  if (ctx.container.noderedClient === undefined) return undefined;
  const probe = await getOrProbeRuntimeInfo(ctx.container, ctx.clock);
  return probe.info !== undefined ? runtimeCapabilitiesFromInfo(probe.info) : undefined;
}
