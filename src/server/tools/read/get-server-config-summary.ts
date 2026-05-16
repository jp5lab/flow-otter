import { z } from 'zod';

import { summarizeConfig } from '../../config/load.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  server_version: z.string(),
  config: z.record(z.unknown()),
});
type Output = z.infer<typeof OutputSchema>;

export const getServerConfigSummaryTool: Tool<Input, Output> = {
  name: 'get_server_config_summary',
  description:
    'Returns the resolved server configuration with secrets redacted to ***SET*** / ***UNSET***. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    return Promise.resolve({
      server_version: ctx.serverVersion,
      config: summarizeConfig(ctx.config),
    });
  },
};
