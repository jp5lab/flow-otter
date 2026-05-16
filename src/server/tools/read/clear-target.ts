import { z } from 'zod';

import { applyTarget } from '../../container.js';
import { clearPersistedTarget, persistedTargetPath } from '../../state/persisted-target.js';
import type { Tool } from '../_tool.js';

const InputSchema = z
  .object({
    env_name: z.string().min(1).optional(),
    revert_in_memory: z.boolean().optional(),
    revert_file_path: z.string().min(1).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  env_name: z.string(),
  persisted_target_path: z.string(),
  removed: z.boolean(),
  reverted_in_memory: z.boolean(),
});
type Output = z.infer<typeof OutputSchema>;

export const clearTargetTool: Tool<Input, Output> = {
  name: 'clear_target',
  description:
    'Clear the persisted target.json for an env_name so the next boot does NOT rehydrate it. Defaults to the current ENVIRONMENT_NAME. Optionally also reverts the in-memory container to a file-source target (revert_in_memory:true). Read-tier (always available).',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      env_name: {
        type: 'string',
        minLength: 1,
        description: 'Which env_name to clear. Defaults to the live container ENVIRONMENT_NAME.',
      },
      revert_in_memory: {
        type: 'boolean',
        description:
          'When true, also re-points the live container to a file source. Use revert_file_path to choose the path; defaults to ./flows.json.',
      },
      revert_file_path: {
        type: 'string',
        minLength: 1,
        description:
          "Used only with revert_in_memory:true. Path to revert the live container to. Defaults to './flows.json'.",
      },
    },
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const envName = input.env_name ?? ctx.container.config.ENVIRONMENT_NAME;
    const filePath = persistedTargetPath(envName);
    const removed = await clearPersistedTarget(envName);

    let revertedInMemory = false;
    if (input.revert_in_memory === true) {
      const targetPath = input.revert_file_path ?? './flows.json';
      applyTarget(ctx.container, {
        kind: 'file',
        file_path: targetPath,
        env_name: envName,
      });
      revertedInMemory = true;
    }

    return {
      ok: true,
      env_name: envName,
      persisted_target_path: filePath,
      removed,
      reverted_in_memory: revertedInMemory,
    };
  },
};
