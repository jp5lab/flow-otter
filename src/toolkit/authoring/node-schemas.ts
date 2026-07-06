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
    // 'burst' added in Node-RED 5.0.0-beta.2 (PR #5391): burst size = `rate`,
    // window = `nbRateUnits` × `rateUnits`, excess dropped (or 2nd output with
    // drop-select "emit"); `allowrate` is ignored in burst mode. Gated by the
    // `delayBurstMode` capability at runtime.
    pauseType: z
      .enum(['delay', 'random', 'rate', 'queue', 'timed', 'delayv', 'randomFirst', 'burst'])
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
    /** tls-config config-node id. TLS options, including SNI, come from that
     *  node; SNI is tls-config.servername. http-request itself has no SNI field. */
    tls: z.string().optional(),
    persist: z.boolean().optional(),
    proxy: z.string().optional(),
    authType: z.enum(['none', 'basic', 'digest', 'bearer']).optional(),
    senderr: z.boolean().optional(),
  })
  .passthrough();

const MqttRetainHandling = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal('0'),
  z.literal('1'),
  z.literal('2'),
]);
const MqttInputCount = z.union([z.literal(0), z.literal(1)]);
const MqttProtocolVersion = z.union([
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal('3'),
  z.literal('4'),
  z.literal('5'),
]);
const MqttLifecycleQos = z.enum(['0', '1', '2']);
const MqttLifecycleRetain = z.enum(['true', 'false']);
const MqttLifecycleMessage = z.record(z.unknown());

// === Config nodes ===

const MqttBrokerPassthrough = z
  .object({
    name: z.string().default(''),
    broker: z.string().default(''),
    port: z.union([z.number(), z.string()]).default(1883),
    /** tls-config config-node id for broker TLS settings. */
    tls: z.string().optional(),
    clientid: z.string().default(''),
    autoConnect: z.boolean().default(true),
    usetls: z.boolean().default(false),
    verifyservercert: z.boolean().default(false),
    compatmode: z.boolean().default(false),
    protocolVersion: MqttProtocolVersion.default(4),
    keepalive: z.union([z.number(), z.string()]).default(60),
    cleansession: z.boolean().default(true),
    autoUnsubscribe: z.boolean().default(true),
    birthTopic: z.string().default(''),
    birthQos: MqttLifecycleQos.default('0'),
    birthRetain: MqttLifecycleRetain.default('false'),
    birthPayload: z.string().default(''),
    birthMsg: MqttLifecycleMessage.default({}),
    closeTopic: z.string().default(''),
    closeQos: MqttLifecycleQos.default('0'),
    closeRetain: MqttLifecycleRetain.default('false'),
    closePayload: z.string().default(''),
    closeMsg: MqttLifecycleMessage.default({}),
    willTopic: z.string().default(''),
    willQos: MqttLifecycleQos.default('0'),
    willRetain: MqttLifecycleRetain.default('false'),
    willPayload: z.string().default(''),
    willMsg: MqttLifecycleMessage.default({}),
    userProps: z.string().default(''),
    sessionExpiry: z.union([z.number(), z.string()]).default(0),
  })
  .passthrough();

const TlsConfigPassthrough = z
  .object({
    name: z.string().default(''),
    /** Editor default is "files" (plural); the runtime falls back to "files"
     *  when certType is absent. */
    certType: z.enum(['files', 'pfx', 'env']).default('files'),
    cert: z.string().default(''),
    key: z.string().default(''),
    ca: z.string().default(''),
    certname: z.string().default(''),
    keyname: z.string().default(''),
    caname: z.string().default(''),
    p12: z.string().default(''),
    p12name: z.string().default(''),
    /** Env-var expressions evaluated by Node-RED when certType is "env". */
    certEnv: z.string().default(''),
    keyEnv: z.string().default(''),
    caEnv: z.string().default(''),
    /** SNI server name; the runtime trims this before use. */
    servername: z.string().default(''),
    verifyservercert: z.boolean().default(true),
    alpnprotocol: z.string().default(''),
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

// === Common-node schemas (eval campaign 2026-06-10, finding #11) ===
// These types previously had NO passthrough validation anywhere — the
// specialist tools accept z.record(z.unknown()) verbatim. The defaults below
// encode runtime requirements the showcase documented the hard way (inject
// needs `repeat` present even when empty; `complete` needs a scope array;
// link nodes need `links`). All fields are optional-with-defaults and the
// schemas are .passthrough(), so any valid existing config still parses.

const InjectPassthrough = z
  .object({
    props: z
      .array(
        z
          .object({ p: z.string(), v: z.string().optional(), vt: z.string().optional() })
          .passthrough(),
      )
      .default([]),
    repeat: z.string().default(''),
    crontab: z.string().default(''),
    once: z.boolean().default(false),
    onceDelay: z.union([z.number(), z.string()]).default(0.1),
    topic: z.string().default(''),
    payload: z.string().default(''),
    payloadType: z.string().default('date'),
  })
  .passthrough();

const DebugPassthrough = z
  .object({
    active: z.boolean().default(true),
    tosidebar: z.boolean().default(true),
    console: z.boolean().default(false),
    tostatus: z.boolean().default(false),
    complete: z.union([z.string(), z.boolean()]).default('payload'),
    targetType: z.enum(['msg', 'full', 'jsonata']).default('msg'),
    statusVal: z.string().default(''),
    statusType: z.string().default('auto'),
  })
  .passthrough();

const FunctionPassthrough = z
  .object({
    func: z.string().default('\nreturn msg;'),
    outputs: z.number().int().nonnegative().default(1),
    timeout: z.union([z.number(), z.string()]).optional(),
    noerr: z.number().default(0),
    initialize: z.string().default(''),
    finalize: z.string().default(''),
    libs: z.array(z.object({ var: z.string(), module: z.string() }).passthrough()).default([]),
  })
  .passthrough();

const MqttInPassthrough = z
  .object({
    topic: z.string().default(''),
    qos: z.enum(['0', '1', '2']).default('2'),
    datatype: z.string().default('auto-detect'),
    /** mqtt-broker config-node id. NOT auto-created by add_node — the agent
     *  must add the broker config node and reference it here. */
    broker: z.string().optional(),
    nl: z.boolean().default(false),
    rap: z.boolean().default(true),
    rh: MqttRetainHandling.default(0),
    inputs: MqttInputCount.default(0),
    // subscriptionIdentifier is intentionally excluded: Node-RED 5.0 does not
    // persist it in editor defaults or read it from node config.
  })
  .passthrough();

const MqttOutPassthrough = z
  .object({
    topic: z.string().default(''),
    qos: z.enum(['', '0', '1', '2']).default(''),
    retain: z.union([z.boolean(), z.string()]).default(''),
    /** mqtt-broker config-node id — see MqttInPassthrough.broker. */
    broker: z.string().optional(),
    respTopic: z.string().default(''),
    contentType: z.string().default(''),
    correl: z.string().default(''),
    expiry: z.string().default(''),
    userProps: z.string().default(''),
  })
  .passthrough();

const LinkInPassthrough = z
  .object({
    links: z.array(z.string()).default([]),
  })
  .passthrough();

const LinkOutPassthrough = z
  .object({
    links: z.array(z.string()).default([]),
    mode: z.enum(['link', 'return']).default('link'),
  })
  .passthrough();

const LinkCallPassthrough = z
  .object({
    links: z.array(z.string()).default([]),
    /** 'dynamic' requires links: [] (target supplied via msg.target);
     *  'static' targets are paired via set_links. */
    linkType: z.enum(['static', 'dynamic']).default('static'),
    timeout: z.union([z.number(), z.string()]).default('30'),
  })
  .passthrough();

const CatchPassthrough = z
  .object({
    scope: z.union([z.null(), z.array(z.string())]).default(null),
    uncaught: z.boolean().default(false),
  })
  .passthrough();

const StatusPassthrough = z
  .object({
    scope: z.union([z.null(), z.array(z.string())]).default(null),
  })
  .passthrough();

const CompletePassthrough = z
  .object({
    /** The runtime requires a scope array of real node ids; an empty array
     *  parses but the node monitors nothing until ids are added. */
    scope: z.array(z.string()).default([]),
    uncaught: z.boolean().default(false),
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
  'mqtt-broker': MqttBrokerPassthrough,
  'tls-config': TlsConfigPassthrough,
  csv: CsvPassthrough,
  json: JsonPassthrough,
  xml: XmlPassthrough,
  'file in': FileInPassthrough,
  file: FilePassthrough,
  exec: ExecPassthrough,
  comment: CommentPassthrough,
  inject: InjectPassthrough,
  debug: DebugPassthrough,
  function: FunctionPassthrough,
  'mqtt in': MqttInPassthrough,
  'mqtt out': MqttOutPassthrough,
  'link in': LinkInPassthrough,
  'link out': LinkOutPassthrough,
  'link call': LinkCallPassthrough,
  catch: CatchPassthrough,
  status: StatusPassthrough,
  complete: CompletePassthrough,
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
