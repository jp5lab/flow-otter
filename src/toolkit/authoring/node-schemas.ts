import { z } from 'zod';

/**
 * Per-type passthrough schemas for Node-RED node configuration fields.
 * Drives the generic `add_node` tool's validation: when the agent supplies
 * `passthrough`, we validate it against the registered schema (if any).
 * Types without a registered schema accept arbitrary passthrough — the
 * agent gets a warning hint to install a node-type extension.
 *
 * Add schemas opportunistically as agents trip over types. The goal is NOT
 * an exhaustive catalogue (Node-RED has 200+ contrib packages) but coverage
 * of the high-frequency core + commonly-used contrib nodes.
 */

// === Core flow primitives ===

const ChangePassthrough = z
  .object({
    rules: z.array(
      z
        .object({
          t: z.enum(['set', 'change', 'delete', 'move', 'replace']),
          p: z.string(),
          pt: z.enum(['msg', 'flow', 'global']).default('msg').optional(),
          to: z.unknown().optional(),
          tot: z.string().optional(),
          from: z.unknown().optional(),
          fromt: z.string().optional(),
          re: z.boolean().optional(),
        })
        .passthrough(),
    ),
    action: z.string().optional(),
    property: z.string().optional(),
    reg: z.boolean().optional(),
  })
  .passthrough();

const SwitchPassthrough = z
  .object({
    property: z.string().default('payload'),
    propertyType: z.string().default('msg'),
    rules: z.array(
      z
        .object({
          t: z.enum([
            'eq',
            'neq',
            'lt',
            'lte',
            'gt',
            'gte',
            'btwn',
            'cont',
            'regex',
            'true',
            'false',
            'null',
            'nnull',
            'empty',
            'nempty',
            'istype',
            'head',
            'index',
            'tail',
            'jsonata_exp',
            'else',
          ]),
          v: z.unknown().optional(),
          vt: z.string().optional(),
          v2: z.unknown().optional(),
          v2t: z.string().optional(),
        })
        .passthrough(),
    ),
    checkall: z.union([z.literal('true'), z.literal('false')]).default('true'),
    repair: z.boolean().optional(),
    outputs: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const TemplatePassthrough = z
  .object({
    field: z.string().default('payload'),
    fieldType: z.enum(['msg', 'flow', 'global']).default('msg'),
    format: z.string().optional(),
    syntax: z.enum(['mustache', 'plain']).default('mustache'),
    template: z.string().default(''),
    output: z.enum(['str', 'json', 'yaml']).default('str'),
  })
  .passthrough();

const DelayPassthrough = z
  .object({
    pauseType: z
      .enum(['delay', 'random', 'rate', 'queue', 'timed', 'delayv', 'randomFirst'])
      .default('delay'),
    timeout: z.number().nonnegative().optional(),
    timeoutUnits: z.enum(['milliseconds', 'seconds', 'minutes', 'hours', 'days']).optional(),
    rate: z.number().positive().optional(),
    nbRateUnits: z.number().positive().optional(),
    rateUnits: z.enum(['second', 'minute', 'hour', 'day']).optional(),
    randomFirst: z.string().optional(),
    randomLast: z.string().optional(),
    randomUnits: z.enum(['milliseconds', 'seconds', 'minutes', 'hours', 'days']).optional(),
    drop: z.boolean().optional(),
    allowrate: z.boolean().optional(),
    outputs: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const TriggerPassthrough = z
  .object({
    op1: z.unknown().optional(),
    op1type: z.string().optional(),
    op2: z.unknown().optional(),
    op2type: z.string().optional(),
    duration: z.union([z.string(), z.number()]).optional(),
    extend: z.boolean().optional(),
    overrideDelay: z.boolean().optional(),
    units: z.enum(['ms', 's', 'min', 'hr']).optional(),
    reset: z.string().optional(),
    bytopic: z.enum(['all', 'topic']).optional(),
    topic: z.string().optional(),
    outputs: z.number().int().nonnegative().optional(),
  })
  .passthrough();

// === HTTP family ===

const HttpInPassthrough = z
  .object({
    url: z.string().min(1),
    method: z.enum(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']).default('get'),
    upload: z.boolean().optional(),
    swaggerDoc: z.string().optional(),
  })
  .passthrough();

const HttpResponsePassthrough = z
  .object({
    statusCode: z.union([z.string(), z.number()]).optional(),
    headers: z.record(z.string()).optional(),
  })
  .passthrough();

const HttpRequestPassthrough = z
  .object({
    method: z
      .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'use'])
      .default('GET'),
    ret: z.enum(['txt', 'bin', 'obj']).default('txt'),
    paytoqs: z.enum(['ignore', 'query', 'body']).default('ignore'),
    url: z.string().optional(),
    tls: z.string().optional(),
    persist: z.boolean().optional(),
    proxy: z.string().optional(),
    authType: z.enum(['none', 'basic', 'digest', 'bearer']).optional(),
    senderr: z.boolean().optional(),
  })
  .passthrough();

// === Data shaping ===

const CsvPassthrough = z
  .object({
    temp: z.string().optional(),
    sep: z.string().default(','),
    hdrin: z.boolean().optional(),
    hdrout: z.enum(['none', 'all', 'once']).default('none'),
    multi: z.enum(['one', 'mult']).default('one'),
    ret: z.enum(['\\n', '\\r', '\\r\\n']).default('\\n'),
    skip: z.union([z.string(), z.number()]).optional(),
    strings: z.boolean().optional(),
    include_empty_strings: z.boolean().optional(),
    include_null_values: z.boolean().optional(),
  })
  .passthrough();

const JsonPassthrough = z
  .object({
    action: z.enum(['', 'str', 'obj']).default(''),
    pretty: z.boolean().optional(),
    property: z.string().default('payload'),
  })
  .passthrough();

const XmlPassthrough = z
  .object({
    attr: z.string().default('$'),
    chr: z.string().default('_'),
    property: z.string().default('payload'),
  })
  .passthrough();

// === I/O ===

const FileInPassthrough = z
  .object({
    filename: z.string().min(1),
    filenameType: z.enum(['str', 'msg', 'env']).default('str'),
    format: z.enum(['utf8', 'utf16', 'lines', 'stream', '']).default('utf8'),
    chunk: z.boolean().optional(),
    sendError: z.boolean().optional(),
    encoding: z.string().optional(),
    allProps: z.boolean().optional(),
  })
  .passthrough();

const FilePassthrough = z
  .object({
    filename: z.string().min(1),
    filenameType: z.enum(['str', 'msg', 'env']).default('str'),
    appendNewline: z.boolean().default(true),
    createDir: z.boolean().default(false),
    overwriteFile: z
      .union([z.literal('true'), z.literal('false'), z.literal('delete')])
      .default('false'),
    encoding: z.string().default('none'),
  })
  .passthrough();

const ExecPassthrough = z
  .object({
    command: z.string().min(1),
    addpay: z.union([z.string(), z.boolean()]).default('payload'),
    append: z.string().default(''),
    useSpawn: z.union([z.literal('true'), z.literal('false')]).default('false'),
    timer: z.string().optional(),
    winHide: z.boolean().optional(),
    oldrc: z.boolean().optional(),
  })
  .passthrough();

// === Catch / status / complete (covered by typed adders too) ===

const CommentPassthrough = z
  .object({
    name: z.string().optional(),
    info: z.string().optional(),
  })
  .passthrough();

// === Registry ===

export const NODE_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = Object.freeze({
  change: ChangePassthrough,
  switch: SwitchPassthrough,
  template: TemplatePassthrough,
  delay: DelayPassthrough,
  trigger: TriggerPassthrough,
  'http in': HttpInPassthrough,
  'http response': HttpResponsePassthrough,
  'http request': HttpRequestPassthrough,
  csv: CsvPassthrough,
  json: JsonPassthrough,
  xml: XmlPassthrough,
  'file in': FileInPassthrough,
  file: FilePassthrough,
  exec: ExecPassthrough,
  comment: CommentPassthrough,
});

export function getNodeSchema(type: string): z.ZodTypeAny | undefined {
  return NODE_SCHEMAS[type];
}

export function hasNodeSchema(type: string): boolean {
  return type in NODE_SCHEMAS;
}

export function knownNodeTypes(): readonly string[] {
  return Object.freeze(Object.keys(NODE_SCHEMAS));
}
