import { z } from 'zod';

const PositionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

const IntPositionSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
  })
  .strict();

const SizeSchema = z
  .object({
    w: z.number().positive(),
    h: z.number().positive(),
  })
  .strict();

const PatchSchema = z
  .object({
    property: z.string().min(1),
    op: z.enum(['replace', 'insert', 'delete']),
    start: z.number().int().min(1),
    end: z.number().int().min(1).optional(),
    content: z.string().optional(),
  })
  .strict();

const AddNodeOpSchema = z
  .object({
    op: z.literal('add_node'),
    tab_id: z.string().min(1),
    type: z.string().min(1),
    opts: z
      .object({
        key: z.string().min(1).optional(),
        label: z.string().max(24).optional(),
        info: z.string().optional(),
        position: IntPositionSchema.optional(),
        group_key: z.string().min(1).optional(),
        passthrough: z.record(z.unknown()).optional(),
        source_node_id: z.string().min(1).optional(),
        source_output_port: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const AddJunctionOpSchema = z
  .object({
    op: z.literal('add_junction'),
    tab_id: z.string().min(1),
    key: z.string().min(1).optional(),
    position: PositionSchema.optional(),
    name: z.string().max(24).optional(),
    group_key: z.string().min(1).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const AddGroupOpSchema = z
  .object({
    op: z.literal('add_group'),
    tab_id: z.string().min(1),
    key: z.string().min(1).optional(),
    name: z.string().min(1).max(24),
    node_keys: z.array(z.string().min(1)).optional(),
    position: PositionSchema.optional(),
    size: SizeSchema.optional(),
    parent_key: z.string().min(1).optional(),
    info: z.string().optional(),
    style: z.record(z.unknown()).optional(),
  })
  .strict();

const AddCommentOpSchema = z
  .object({
    op: z.literal('add_comment'),
    tab_id: z.string().min(1),
    key: z.string().min(1).optional(),
    text: z.string().min(1),
    position: PositionSchema.optional(),
    info: z.string().optional(),
    group_key: z.string().min(1).optional(),
  })
  .strict();

const WireNodesOpSchema = z
  .object({
    op: z.literal('wire_nodes'),
    tab_id: z.string().min(1),
    from_key: z.string().min(1),
    to_key: z.string().min(1),
    output_port: z.number().int().nonnegative().optional(),
  })
  .strict();

const SetWiresOpSchema = z
  .object({
    op: z.literal('set_wires'),
    tab_id: z.string().min(1),
    source_node_id: z.string().min(1),
    output_port: z.number().int().nonnegative().optional(),
    target_node_ids: z.array(z.string().min(1)),
  })
  .strict();

const SetLinksOpSchema = z
  .object({
    op: z.literal('set_links'),
    source_node_id: z.string().min(1),
    target_node_ids: z.array(z.string().min(1)),
  })
  .strict();

const RemoveNodeOpSchema = z
  .object({
    op: z.literal('remove_node'),
    tab_id: z.string().min(1),
    node_id: z.string().min(1),
  })
  .strict();

const RemoveCommentOpSchema = z
  .object({
    op: z.literal('remove_comment'),
    tab_id: z.string().min(1),
    comment_key: z.string().min(1),
  })
  .strict();

const UpdateNodeOpSchema = z
  .object({
    op: z.literal('update_node'),
    tab_id: z.string().min(1),
    node_id: z.string().min(1),
    label: z.string().max(24).optional(),
    info: z.string().nullable().optional(),
    position: PositionSchema.optional(),
    group_key: z.string().min(1).nullable().optional(),
    disabled: z.boolean().optional(),
    passthrough: z.record(z.unknown()).optional(),
    patches: z.array(PatchSchema).optional(),
  })
  .strict();

const MoveNodeOpSchema = z
  .object({
    op: z.literal('move_node'),
    tab_id: z.string().min(1),
    node_id: z.string().min(1),
    dest_tab_id: z.string().min(1).optional(),
    position: PositionSchema.optional(),
  })
  .strict();

const UpdateGroupOpSchema = z
  .object({
    op: z.literal('update_group'),
    tab_id: z.string().min(1),
    group_key: z.string().min(1),
    name: z.string().min(1).max(24).optional(),
    node_keys: z.array(z.string().min(1)).optional(),
    position: PositionSchema.optional(),
    size: SizeSchema.optional(),
    parent_key: z.string().min(1).nullable().optional(),
    info: z.string().nullable().optional(),
    style: z.record(z.unknown()).nullable().optional(),
    passthrough: z.record(z.unknown()).optional(),
    refit: z.boolean().optional(),
  })
  .strict();

const RemoveGroupOpSchema = z
  .object({
    op: z.literal('remove_group'),
    tab_id: z.string().min(1),
    group_key: z.string().min(1),
  })
  .strict();

const UpdateCommentOpSchema = z
  .object({
    op: z.literal('update_comment'),
    tab_id: z.string().min(1),
    comment_key: z.string().min(1),
    text: z.string().min(1).optional(),
    position: PositionSchema.optional(),
    size: SizeSchema.nullable().optional(),
    info: z.string().nullable().optional(),
    group_key: z.string().min(1).nullable().optional(),
  })
  .strict();

export const StageChangesOpSchema = z.discriminatedUnion('op', [
  AddNodeOpSchema,
  AddJunctionOpSchema,
  AddGroupOpSchema,
  AddCommentOpSchema,
  WireNodesOpSchema,
  SetWiresOpSchema,
  SetLinksOpSchema,
  RemoveNodeOpSchema,
  RemoveCommentOpSchema,
  UpdateNodeOpSchema,
  MoveNodeOpSchema,
  UpdateGroupOpSchema,
  RemoveGroupOpSchema,
  UpdateCommentOpSchema,
]);

export type StageChangesOp = z.infer<typeof StageChangesOpSchema>;

const positionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: { x: { type: 'number' }, y: { type: 'number' } },
};

const sizeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['w', 'h'],
  properties: {
    w: { type: 'number', exclusiveMinimum: 0 },
    h: { type: 'number', exclusiveMinimum: 0 },
  },
};

export const stageChangesOpJsonSchema: Readonly<Record<string, unknown>> = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'type'],
      properties: {
        op: { const: 'add_node' },
        tab_id: { type: 'string', minLength: 1 },
        type: { type: 'string', minLength: 1 },
        opts: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', minLength: 1 },
            label: { type: 'string', maxLength: 24 },
            info: { type: 'string' },
            position: positionJsonSchema,
            group_key: { type: 'string', minLength: 1 },
            passthrough: { type: 'object', additionalProperties: true },
            source_node_id: { type: 'string', minLength: 1 },
            source_output_port: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id'],
      properties: {
        op: { const: 'add_junction' },
        tab_id: { type: 'string', minLength: 1 },
        key: { type: 'string', minLength: 1 },
        position: positionJsonSchema,
        name: { type: 'string', maxLength: 24 },
        group_key: { type: 'string', minLength: 1 },
        disabled: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'name'],
      properties: {
        op: { const: 'add_group' },
        tab_id: { type: 'string', minLength: 1 },
        key: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1, maxLength: 24 },
        node_keys: { type: 'array', items: { type: 'string', minLength: 1 } },
        position: positionJsonSchema,
        size: sizeJsonSchema,
        parent_key: { type: 'string', minLength: 1 },
        info: { type: 'string' },
        style: { type: 'object', additionalProperties: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'text'],
      properties: {
        op: { const: 'add_comment' },
        tab_id: { type: 'string', minLength: 1 },
        key: { type: 'string', minLength: 1 },
        text: { type: 'string', minLength: 1 },
        position: positionJsonSchema,
        info: { type: 'string' },
        group_key: { type: 'string', minLength: 1 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'from_key', 'to_key'],
      properties: {
        op: { const: 'wire_nodes' },
        tab_id: { type: 'string', minLength: 1 },
        from_key: { type: 'string', minLength: 1 },
        to_key: { type: 'string', minLength: 1 },
        output_port: { type: 'integer', minimum: 0 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'source_node_id', 'target_node_ids'],
      properties: {
        op: { const: 'set_wires' },
        tab_id: { type: 'string', minLength: 1 },
        source_node_id: { type: 'string', minLength: 1 },
        output_port: { type: 'integer', minimum: 0 },
        target_node_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'source_node_id', 'target_node_ids'],
      properties: {
        op: { const: 'set_links' },
        source_node_id: { type: 'string', minLength: 1 },
        target_node_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'node_id'],
      properties: {
        op: { const: 'remove_node' },
        tab_id: { type: 'string', minLength: 1 },
        node_id: { type: 'string', minLength: 1 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'comment_key'],
      properties: {
        op: { const: 'remove_comment' },
        tab_id: { type: 'string', minLength: 1 },
        comment_key: { type: 'string', minLength: 1 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'node_id'],
      properties: {
        op: { const: 'update_node' },
        tab_id: { type: 'string', minLength: 1 },
        node_id: { type: 'string', minLength: 1 },
        label: { type: 'string', maxLength: 24 },
        info: { type: ['string', 'null'] },
        position: positionJsonSchema,
        group_key: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        disabled: { type: 'boolean' },
        passthrough: { type: 'object', additionalProperties: true },
        patches: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'node_id'],
      properties: {
        op: { const: 'move_node' },
        tab_id: { type: 'string', minLength: 1 },
        node_id: { type: 'string', minLength: 1 },
        dest_tab_id: { type: 'string', minLength: 1 },
        position: positionJsonSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'group_key'],
      properties: {
        op: { const: 'update_group' },
        tab_id: { type: 'string', minLength: 1 },
        group_key: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1, maxLength: 24 },
        node_keys: { type: 'array', items: { type: 'string', minLength: 1 } },
        position: positionJsonSchema,
        size: sizeJsonSchema,
        parent_key: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        info: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        style: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
        passthrough: { type: 'object', additionalProperties: true },
        refit: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'group_key'],
      properties: {
        op: { const: 'remove_group' },
        tab_id: { type: 'string', minLength: 1 },
        group_key: { type: 'string', minLength: 1 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'tab_id', 'comment_key'],
      properties: {
        op: { const: 'update_comment' },
        tab_id: { type: 'string', minLength: 1 },
        comment_key: { type: 'string', minLength: 1 },
        text: { type: 'string', minLength: 1 },
        position: positionJsonSchema,
        size: { anyOf: [sizeJsonSchema, { type: 'null' }] },
        info: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        group_key: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
      },
    },
  ],
};
