import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { Container } from '../container.js';
import { findPrompt, PROMPTS } from '../prompts/registry.js';
import type { ToolRegistry } from '../tools/register.js';

export interface StartStdioOptions {
  container: Container;
  registry: ToolRegistry;
  serverInfo: { name: string; version: string };
  /**
   * Optional server-level instructions (≤2KB by Claude Code convention).
   * Injected system-prompt style by clients that support it.
   */
  instructions?: string;
}

export async function startStdio(opts: StartStdioOptions): Promise<{
  shutdown: () => Promise<void>;
}> {
  const server = new Server(
    { name: opts.serverInfo.name, version: opts.serverInfo.version },
    {
      capabilities: { tools: {}, prompts: {} },
      ...(opts.instructions !== undefined ? { instructions: opts.instructions } : {}),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools = opts.registry.listTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputJsonSchema,
      annotations: t.annotations,
    }));
    return { tools };
  });

  // Prompts surface as /mcp__flow-otter__<name> slash commands in Claude Code.
  // Each prompt is a structured workflow walking the agent through a common
  // task (new_flow, build_operator_dashboard, refactor_to_subflow, etc.).
  // See src/server/prompts/registry.ts.
  server.setRequestHandler(ListPromptsRequestSchema, () => {
    return {
      prompts: PROMPTS.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments.map((a) => ({
          name: a.name,
          description: a.description,
          ...(a.required !== undefined ? { required: a.required } : {}),
        })),
      })),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, (req) => {
    const name = req.params.name;
    const prompt = findPrompt(name);
    if (prompt === undefined) {
      throw new Error(`Unknown prompt: ${name}`);
    }
    const args = req.params.arguments ?? {};
    const text = prompt.build(args);
    return {
      description: prompt.description,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = opts.registry.find(name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      };
    }
    try {
      const validated = tool.inputZod.parse(args ?? {});
      const result = await tool.invoke(validated, opts.container);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.container.logger.error({ tool: name, err: message }, 'tool invocation failed');
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool '${name}' failed: ${message}` }],
      };
    }
  });

  // Attach the MCP Server to the typed Container slot so tool handlers can
  // call elicitInput / send notifications. Tools should still consume it
  // through the typed helpers (src/server/elicitation/client.ts) rather than
  // reaching for it directly.
  opts.container.mcpServer = server;

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    shutdown: async () => {
      await server.close();
    },
  };
}
