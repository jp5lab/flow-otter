import os from 'node:os';
import path from 'node:path';

import { ValidationFailedError } from '../tools/_tool.js';

const ENV_NAME_CHARS = /^[A-Za-z0-9._-]+$/;
const MAX_ENV_NAME_LENGTH = 64;

/**
 * Validate that an `env_name` is safe to use as a path segment under
 * `~/.flow-otter/`. The env_name becomes part of `~/.flow-otter/<env_name>/`
 * and is therefore a path-traversal vector if not constrained.
 *
 * Rules:
 *   - only [A-Za-z0-9._-]
 *   - 1..64 chars
 *   - cannot be `.` or `..` (path-traversal special segments)
 *   - cannot start with `.` (hidden-file convention; avoids confusion with
 *     `.flow-otter` itself or `.git`-style siblings)
 */
export function validateEnvName(envName: string): void {
  if (typeof envName !== 'string' || envName.length === 0) {
    throw new ValidationFailedError('env_name must be a non-empty string.', [
      { rule: 'env-name', reason: 'empty' },
    ]);
  }
  if (envName.length > MAX_ENV_NAME_LENGTH) {
    throw new ValidationFailedError(
      `env_name exceeds the ${MAX_ENV_NAME_LENGTH}-character maximum.`,
      [{ rule: 'env-name', reason: 'too-long', length: envName.length }],
    );
  }
  if (!ENV_NAME_CHARS.test(envName)) {
    throw new ValidationFailedError(
      `env_name '${envName}' contains characters outside [A-Za-z0-9._-]. Path separators and other special characters are rejected to prevent state-directory escape.`,
      [{ rule: 'env-name', reason: 'illegal-chars', value: envName }],
    );
  }
  if (envName === '.' || envName === '..') {
    throw new ValidationFailedError(`env_name '${envName}' is reserved (path-traversal segment).`, [
      { rule: 'env-name', reason: 'reserved', value: envName },
    ]);
  }
  if (envName.startsWith('.')) {
    throw new ValidationFailedError(
      `env_name '${envName}' cannot start with '.' (hidden-file convention).`,
      [{ rule: 'env-name', reason: 'leading-dot', value: envName }],
    );
  }
}

export type StateDirLabel = 'snapshot_dir' | 'staging_dir' | 'audit_log_path';

/**
 * Validate that a caller-supplied state directory or file path is safe.
 * Required to be an absolute path. Resolves to canonical form and rejects
 * paths that escape the user's home directory.
 *
 * The home-directory restriction is intentional: callers who genuinely need
 * state outside `~/` can set the corresponding env var at process startup
 * (`SNAPSHOT_DIR`, `STAGING_DIR`, `AUDIT_LOG_PATH`) — those bypass this
 * check because they are operator-set, not agent-set.
 */
export function validateUserSuppliedStatePath(label: StateDirLabel, candidate: string): void {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new ValidationFailedError(`${label} must be a non-empty string.`, [
      { rule: 'state-path', label, reason: 'empty' },
    ]);
  }
  if (!path.isAbsolute(candidate)) {
    throw new ValidationFailedError(`${label} '${candidate}' must be an absolute path.`, [
      { rule: 'state-path', label, reason: 'not-absolute', value: candidate },
    ]);
  }
  const resolved = path.resolve(candidate);
  const home = path.resolve(os.homedir());
  // Allow exactly $HOME and anything inside; reject paths above.
  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    throw new ValidationFailedError(
      `${label} '${candidate}' resolves outside the user's home directory (${home}). Set ${label.toUpperCase()} as a process env var at startup if you need a different root.`,
      [{ rule: 'state-path', label, reason: 'outside-home', value: candidate, resolved, home }],
    );
  }
}
