import { z } from 'zod';

import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  DANGEROUS_CONFIRMATION_TEXT,
  DANGEROUS_OPERATIONS,
  dangerousToken,
} from './_confirmation.js';

const InputSchema = z
  .object({
    operation: z.enum(DANGEROUS_OPERATIONS),
    confirmation_text: z.literal(DANGEROUS_CONFIRMATION_TEXT),
    target: z.string().min(1).optional(),
    flows_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  operation: z.enum(DANGEROUS_OPERATIONS),
  confirmation_token: z.string(),
  confirmation_text_required: z.literal(DANGEROUS_CONFIRMATION_TEXT),
  environment: z.string(),
  actor: z.string(),
  target: z.string().optional(),
  flows_hash: z.string().optional(),
});
type Output = z.infer<typeof OutputSchema>;

export const prepareDangerousOperationTool: Tool<Input, Output> = {
  name: 'prepare_dangerous_operation',
  description:
    'Issues a confirmation token for one dangerous operation. Tokens are scoped to the actor, environment, operation, and target/hash where applicable.',
  tier: 'dangerous',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: DANGEROUS_OPERATIONS as unknown as string[] },
      confirmation_text: { type: 'string', const: DANGEROUS_CONFIRMATION_TEXT },
      target: { type: 'string', minLength: 1 },
      flows_hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    },
    required: ['operation', 'confirmation_text'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) => {
    if (input.operation === 'replace_flows' && input.flows_hash === undefined) {
      throw new ValidationFailedError(
        'replace_flows requires flows_hash when preparing a token.',
        [],
      );
    }
    if (input.operation === 'delete_tab' && input.target === undefined) {
      throw new ValidationFailedError('delete_tab requires target when preparing a token.', []);
    }
    if (input.operation === 'reset_runtime' && input.target !== undefined) {
      throw new ValidationFailedError('reset_runtime does not accept target.', []);
    }

    const scope = {
      operation: input.operation,
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      ...(input.target !== undefined ? { target: input.target } : {}),
      ...(input.flows_hash !== undefined ? { flowsHash: input.flows_hash } : {}),
    };
    const token = dangerousToken(scope);

    ctx.enrichAudit({
      mode: 'dangerous',
      diff_summary: {
        nodes_added: 0,
        nodes_removed: 0,
        nodes_modified: 0,
        wires_added: 0,
        wires_removed: 0,
      },
    });

    return Promise.resolve({
      ok: true,
      operation: input.operation,
      confirmation_token: token,
      confirmation_text_required: DANGEROUS_CONFIRMATION_TEXT,
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      ...(input.target !== undefined ? { target: input.target } : {}),
      ...(input.flows_hash !== undefined ? { flows_hash: input.flows_hash } : {}),
    });
  },
};
