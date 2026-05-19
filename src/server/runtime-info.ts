/**
 * Lazy, cached probe of the connected Node-RED runtime's version + capabilities.
 *
 * The runtime info is detected on demand (first health_check, first tool
 * that needs a capability gate) and cached on the container for the lifetime
 * of the current target binding. `clearRuntimeInfo` is called by applyTarget
 * when the binding changes so we never leak stale info between targets.
 */

import {
  isPrerelease,
  resolveCapabilities,
  type RuntimeInfo,
} from '../adapters/nodered/capabilities.js';

import type { Container } from './container.js';

interface RuntimeInfoSlot {
  runtimeInfo?: RuntimeInfo;
}

export interface RuntimeInfoProbeResult {
  /** Successfully detected info, OR undefined if there's no admin-api client. */
  readonly info: RuntimeInfo | undefined;
  /** Non-fatal warning produced during the probe (e.g. /settings unreachable). */
  readonly warning?: { readonly code: string; readonly message: string };
}

/**
 * Returns cached runtime info if present; otherwise probes Node-RED (via
 * the admin client) and caches the result. If the container is bound to a
 * file source (no admin-api), returns undefined silently — there's no
 * runtime to probe.
 *
 * The cache is invalidated by clearRuntimeInfo, called from applyTarget
 * whenever the container is re-bound.
 */
export async function getOrProbeRuntimeInfo(
  container: Container,
  clock: () => Date = () => new Date(),
): Promise<RuntimeInfoProbeResult> {
  const slot = container as unknown as RuntimeInfoSlot;
  if (slot.runtimeInfo !== undefined) return { info: slot.runtimeInfo };

  const client = container.noderedClient;
  if (client === undefined) return { info: undefined };

  try {
    const v = await client.getNoderedVersion();
    const info: RuntimeInfo = {
      name: 'node-red',
      version: v.version,
      is_prerelease: isPrerelease(v.version),
      ...(v.nodeJsVersion !== undefined ? { node_js_version: v.nodeJsVersion } : {}),
      detected_at: clock().toISOString(),
      capabilities: resolveCapabilities(v.version),
    };
    slot.runtimeInfo = info;
    return { info };
  } catch (err) {
    return {
      info: undefined,
      warning: {
        code: 'version-probe-failed',
        message: `Could not detect Node-RED version: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

/**
 * Clear cached runtime info. Call this whenever the target binding changes
 * (applyTarget) so the next probe sees the new runtime.
 */
export function clearRuntimeInfo(container: Container): void {
  const slot = container as unknown as RuntimeInfoSlot;
  delete slot.runtimeInfo;
}
