import { isTierEnabled } from '../config/tiers.js';
import type { Container } from '../container.js';

import { makeInvokable, type InvokableTool, type Tool } from './_tool.js';

export interface ToolRegistry {
  register<TIn, TOut>(tool: Tool<TIn, TOut>): void;
  listTools(): readonly InvokableTool[];
  find(name: string): InvokableTool | undefined;
}

export function buildRegistry(
  container: Container,
  tools: readonly Tool<unknown, unknown>[],
): ToolRegistry {
  const registered = new Map<string, InvokableTool>();
  const list: InvokableTool[] = [];

  for (const tool of tools) {
    if (!isTierEnabled(tool.tier, container.config)) continue;
    const invokable = makeInvokable(tool);
    registered.set(invokable.name, invokable);
    list.push(invokable);
  }

  return {
    register: <TIn, TOut>(tool: Tool<TIn, TOut>): void => {
      if (!isTierEnabled(tool.tier, container.config)) return;
      const invokable = makeInvokable(tool);
      registered.set(invokable.name, invokable);
      list.push(invokable);
    },
    listTools: () => list,
    find: (name) => registered.get(name),
  };
}
