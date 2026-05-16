import { ALL_CONFIG_KEYS, ConfigSchema, SECRET_CONFIG_KEYS, type Config } from './schema.js';

export class ConfigError extends Error {
  constructor(
    public readonly issues: readonly { path: string; message: string }[],
    message: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw: Record<string, unknown> = {};
  for (const key of ALL_CONFIG_KEYS) {
    const value = env[key as string];
    if (value !== undefined) raw[key as string] = value;
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new ConfigError(
      issues,
      `Invalid configuration: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    );
  }
  return Object.freeze(result.data);
}

export function summarizeConfig(config: Config): Record<string, unknown> {
  const secretSet = new Set<string>(SECRET_CONFIG_KEYS as readonly string[]);
  const out: Record<string, unknown> = {};
  for (const key of ALL_CONFIG_KEYS as readonly string[]) {
    const value = (config as unknown as Record<string, unknown>)[key];
    if (secretSet.has(key)) {
      out[key] = value === undefined || value === '' ? '***UNSET***' : '***SET***';
    } else {
      out[key] = value;
    }
  }
  return out;
}
