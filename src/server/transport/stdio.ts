import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { Container } from '../container.js';
import type { ToolRegistry } from '../tools/register.js';

export interface StartStdioOptions {
  container: Container;
  registry: ToolRegistry;
  serverInfo: { name: string; version: string };
}

export async function startStdio(opts: StartStdioOptions): Promise<{
  shutdown: () => Promise<void>;
}> {
  const server = new Server(
    { name: opts.serverInfo.name, version: opts.serverInfo.version },
    { capabilities: { tools: {} } },
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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    shutdown: async () => {
      await server.close();
    },
  };
}
