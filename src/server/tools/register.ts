import { isTierEnabled } from '../config/tiers.js';
import type { Container } from '../container.js';

import { makeInvokable, type InvokableTool, type Tool } from './_tool.js';
import { DEFAULT_TOOLSETS, TOOLSETS, toolsetOf, type ToolsetName } from './toolsets.js';

export interface ToolRegistry {
  register<TIn, TOut>(tool: Tool<TIn, TOut>): void;
  /** Visible tools (filtered by enabled toolsets + tier enablement). */
  listTools(): readonly InvokableTool[];
  /** Resolve a tool by name if visible, or if its disabled toolset remains callable. */
  find(name: string): InvokableTool | undefined;
  /** Enabled toolsets (read-only snapshot of current state). */
  enabledToolsets(): readonly ToolsetName[];
  /** Enable a toolset and return the tool names it added to the visible surface. */
  enableToolset(name: ToolsetName): {
    ok: true;
    added: readonly string[];
    already_enabled: boolean;
  };
}

export function buildRegistry(
  container: Container,
  tools: readonly Tool<unknown, unknown>[],
): ToolRegistry {
  // Every tool whose tier is enabled lives here, regardless of toolset.
  const allByName = new Map<string, InvokableTool>();
  const enabled = new Set<ToolsetName>(DEFAULT_TOOLSETS);
  // If the operator has explicitly opted into dangerous tools via the env
  // var, surface them in listTools() automatically — the existing
  // ENABLE_DANGEROUS_TOOLS gate is the security signal. Keeps the toolset
  // visibility layer aligned with operator intent, no extra enable_toolset
  // dance required.
  if (isTierEnabled('dangerous', container.config)) enabled.add('dangerous');

  function ingest(tool: Tool<unknown, unknown>): void {
    if (!isTierEnabled(tool.tier, container.config)) return;
    const invokable = makeInvokable(tool);
    allByName.set(invokable.name, invokable);
  }

  for (const tool of tools) ingest(tool);

  function isVisible(name: string): boolean {
    return enabled.has(toolsetOf(name));
  }

  function isCallable(name: string): boolean {
    const owner = TOOLSETS[toolsetOf(name)];
    return enabled.has(owner.name) || owner.callable_when_disabled;
  }

  return {
    register: <TIn, TOut>(tool: Tool<TIn, TOut>): void => {
      ingest(tool as unknown as Tool<unknown, unknown>);
    },
    listTools: () => [...allByName.values()].filter((t) => isVisible(t.name)),
    find: (name) => {
      const t = allByName.get(name);
      if (t === undefined) return undefined;
      if (!isCallable(name)) return undefined;
      return t;
    },
    enabledToolsets: () => [...enabled],
    enableToolset: (name: ToolsetName) => {
      if (!(name in TOOLSETS)) {
        throw new Error(`Unknown toolset: ${name}`);
      }
      if (enabled.has(name)) {
        return { ok: true, added: [], already_enabled: true };
      }
      enabled.add(name);
      const added = TOOLSETS[name].tool_names.filter((tn) => allByName.has(tn));
      return { ok: true, added, already_enabled: false };
    },
  };
}
