import { z } from 'zod';

import { selectCatalog } from '../../../toolkit/catalog/index.js';
import type { Tool } from '../_tool.js';

const CATEGORY_VALUES = [
  'node_red_concepts',
  'core_node_types',
  'dashboard_widgets',
  'templates',
  'validators',
  'design_principles',
  'methodology',
] as const;

const InputSchema = z
  .object({
    categories: z.array(z.enum(CATEGORY_VALUES)).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

// Output is the catalog subset. We don't fully constrain it via Zod here —
// the shape is determined by the requested categories, and exhaustively
// validating it on the way out would just duplicate the typed builder.
// Tests verify the shape against the catalog types.
const OutputSchema = z.object({}).passthrough();
type Output = z.infer<typeof OutputSchema>;

export const getAuthoringGuideTool: Tool<Input, Output> = {
  name: 'get_authoring_guide',
  description:
    'Returns the FlowOtter capability catalog: Node-RED concepts, core node types, Dashboard 2.0 widgets (with FlowOtter support status), built-in templates, validators, ISA-101 design principles, and the authoring methodology. Filter via `categories` to load only what you need (default: full catalog). Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      categories: {
        type: 'array',
        items: { type: 'string', enum: [...CATEGORY_VALUES] },
        description:
          'Optional subset filter. Omit to return the full catalog. Valid values: node_red_concepts, core_node_types, dashboard_widgets, templates, validators, design_principles, methodology.',
      },
    },
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    Promise.resolve(selectCatalog(ctx.serverVersion, input.categories) as unknown as Output),
};
