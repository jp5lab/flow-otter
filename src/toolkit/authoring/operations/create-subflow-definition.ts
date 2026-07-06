import type {
  AuthoringSpec,
  ConnectionSpec,
  NodeSpec,
  SubflowDefSpec,
  TabEnvEntry,
} from '../types.js';

export interface CreateSubflowDefinitionOpts {
  /** Custom def id. Auto-generated as `subflow-def` (with collision suffix) if omitted. */
  id?: string;
  name: string;
  nodes?: readonly NodeSpec[];
  connections?: readonly ConnectionSpec[];
  env?: readonly TabEnvEntry[];
  passthrough?: Readonly<Record<string, unknown>>;
}

export interface CreateSubflowDefinitionResult {
  spec: AuthoringSpec;
  newDefId: string;
}

const DEFAULTS = {
  baseId: 'subflow-def',
};

class CreateSubflowDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateSubflowDefinitionError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function createSubflowDefinition(
  spec: AuthoringSpec,
  opts: CreateSubflowDefinitionOpts,
): CreateSubflowDefinitionResult {
  if (opts.name === '') {
    throw new CreateSubflowDefinitionError('Subflow definition name must be non-empty.');
  }

  const existing = spec.subflowDefs ?? [];
  const taken = new Set(existing.map((d) => d.id));
  const newDefId = uniqueKey(opts.id ?? DEFAULTS.baseId, taken);

  const newDef: SubflowDefSpec = {
    id: newDefId,
    name: opts.name,
    ...(opts.env !== undefined ? { env: opts.env.map((entry) => ({ ...entry })) } : {}),
    nodes: opts.nodes ?? [],
    connections: opts.connections ?? [],
    ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
  };

  return {
    spec: { ...spec, subflowDefs: [...existing, newDef] },
    newDefId,
  };
}
