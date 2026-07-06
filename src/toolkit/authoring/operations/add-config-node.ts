import type { AuthoringSpec, ConfigNodeSpec } from '../types.js';

export interface AddConfigNodeOpts {
  /** Stable global config-node key. Must be unique within spec.configNodes. */
  key: string;
  /** Node-RED config node type, e.g. 'mqtt-broker' or 'tls-config'. */
  type: string;
  label?: string;
  passthrough?: Readonly<Record<string, unknown>>;
}

export interface AddConfigNodeResult {
  spec: AuthoringSpec;
  newConfigNodeKey: string;
}

class AddConfigNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddConfigNodeError';
  }
}

export function addConfigNode(spec: AuthoringSpec, opts: AddConfigNodeOpts): AddConfigNodeResult {
  if (opts.key.length === 0) throw new AddConfigNodeError('Config node key must be non-empty.');
  if (opts.type.length === 0) throw new AddConfigNodeError('Config node type must be non-empty.');

  const existing = spec.configNodes ?? [];
  if (existing.some((n) => n.key === opts.key)) {
    throw new AddConfigNodeError(`Config node key '${opts.key}' already exists.`);
  }

  const newConfigNode: ConfigNodeSpec = {
    key: opts.key,
    type: opts.type,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
  };

  return {
    spec: { ...spec, configNodes: [...existing, newConfigNode] },
    newConfigNodeKey: opts.key,
  };
}
