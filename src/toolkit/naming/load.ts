import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

import { NamingContractSchema, type NamingContract } from './schema.js';

export class NamingContractError extends Error {
  override readonly name = 'NamingContractError';
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export function loadNamingContract(filePath: string): NamingContract | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new NamingContractError(`Failed to read naming contract at ${filePath}`, err);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new NamingContractError(`Malformed YAML in naming contract at ${filePath}`, err);
  }
  const result = NamingContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new NamingContractError(
      `Naming contract at ${filePath} failed schema validation: ${result.error.message}`,
      result.error,
    );
  }
  return result.data;
}
