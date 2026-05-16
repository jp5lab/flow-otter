import { z } from 'zod';

import { listTemplates } from '../../../toolkit/templates/index.js';
import { type Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const ParameterSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const OutputSchema = z.object({
  templates: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.array(ParameterSchema),
    }),
  ),
});
type Output = z.infer<typeof OutputSchema>;

export const listTemplatesTool: Tool<Input, Output> = {
  name: 'list_templates',
  description: 'Lists built-in flow templates that can be staged with instantiate_template.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: () =>
    Promise.resolve({
      templates: listTemplates().map((template) => ({
        name: template.name,
        description: template.description,
        parameters: template.parameters.map((parameter) => ({ ...parameter })),
      })),
    }),
};
