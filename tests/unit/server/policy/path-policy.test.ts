import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  validateEnvName,
  validateUserSuppliedStatePath,
} from '../../../../src/server/policy/path-policy.js';

describe('validateEnvName', () => {
  it.each([
    ['production', true],
    ['local-dev', true],
    ['lab_42', true],
    ['my.env.name', true],
    ['x', true],
    ['', false],
    ['..', false],
    ['.', false],
    ['../etc', false],
    ['foo/bar', false],
    ['foo\\bar', false],
    ['foo bar', false],
    ['foo;rm -rf /', false],
    ['$HOME', false],
    ['.hidden', false],
    ['a'.repeat(65), false],
  ])("env_name '%s' accepted=%s", (name, accept) => {
    if (accept) {
      expect(() => validateEnvName(name)).not.toThrow();
    } else {
      expect(() => validateEnvName(name)).toThrow();
    }
  });
});

describe('validateUserSuppliedStatePath', () => {
  const home = os.homedir();

  it('accepts an absolute path under the user home', () => {
    expect(() =>
      validateUserSuppliedStatePath('snapshot_dir', path.join(home, 'state', 'snapshots')),
    ).not.toThrow();
  });

  it('accepts the home directory itself', () => {
    expect(() => validateUserSuppliedStatePath('audit_log_path', home)).not.toThrow();
  });

  it('rejects a relative path', () => {
    expect(() => validateUserSuppliedStatePath('snapshot_dir', './snapshots')).toThrow(
      /absolute path/,
    );
  });

  it('rejects a path outside the home directory', () => {
    expect(() => validateUserSuppliedStatePath('snapshot_dir', '/etc/cron.d')).toThrow(
      /home directory/,
    );
  });

  it('rejects a path that traverses outside home via ..', () => {
    const escape = path.join(home, '..', 'somewhere-else');
    expect(() => validateUserSuppliedStatePath('staging_dir', escape)).toThrow(/home directory/);
  });

  it('rejects an empty path', () => {
    expect(() => validateUserSuppliedStatePath('audit_log_path', '')).toThrow();
  });
});
