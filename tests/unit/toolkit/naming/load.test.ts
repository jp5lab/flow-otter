import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NamingContractError, loadNamingContract } from '../../../../src/toolkit/naming/load.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'naming-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadNamingContract', () => {
  it('returns null when the file does not exist', () => {
    const missing = path.join(dir, 'does-not-exist.yaml');
    expect(loadNamingContract(missing)).toBeNull();
  });

  it('parses a valid contract', async () => {
    const file = path.join(dir, 'naming.yaml');
    const yaml = [
      'schemaVersion: 1',
      "forbiddenLabelChars: '[!@]'",
      'types:',
      '  inject:',
      "    labelPattern: '^[A-Z]'",
      '    labelMaxLen: 24',
      '  function:',
      '    requiredFields:',
      '      - func',
      '',
    ].join('\n');
    await writeFile(file, yaml, 'utf8');
    const contract = loadNamingContract(file);
    expect(contract).not.toBeNull();
    expect(contract?.schemaVersion).toBe(1);
    expect(contract?.forbiddenLabelChars).toBe('[!@]');
    expect(contract?.types?.inject?.labelPattern).toBe('^[A-Z]');
    expect(contract?.types?.inject?.labelMaxLen).toBe(24);
    expect(contract?.types?.function?.requiredFields).toEqual(['func']);
  });

  it('throws NamingContractError for malformed YAML', async () => {
    const file = path.join(dir, 'broken.yaml');
    await writeFile(file, 'key: : :\n', 'utf8');
    try {
      loadNamingContract(file);
      expect.fail('expected loadNamingContract to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NamingContractError);
      expect((err as NamingContractError).cause).toBeDefined();
    }
  });

  it('throws NamingContractError when schema validation fails', async () => {
    const file = path.join(dir, 'invalid.yaml');
    await writeFile(file, "forbiddenLabelChars: '[!@]'\n", 'utf8');
    try {
      loadNamingContract(file);
      expect.fail('expected loadNamingContract to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NamingContractError);
    }
  });
});
