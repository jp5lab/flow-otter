import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/naming-contract.js';

const FIXTURE = path.join(__dirname, '../../../../fixtures/broken/naming-contract.flows.json');

describe('naming-contract', () => {
  it('passes when no forbidden substrings appear', () => {
    expect(
      check([
        { id: 'a', type: 'tab', label: 'Pipeline' },
        { id: 'd1', type: 'debug', z: 'a', x: 0, y: 0, wires: [], name: 'Output' },
      ] as never),
    ).toEqual([]);
  });

  it('flags TODO substring in fixture', async () => {
    const flows = JSON.parse(await readFile(FIXTURE, 'utf8')) as never;
    const out = check(flows);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.context?.substring).toBe('TODO');
  });

  it('flags multiple forbidden substrings independently', () => {
    const out = check([{ id: 'a', type: 'tab', label: 'TODO XXX' }] as never);
    expect(out.length).toBe(2);
  });

  it('flags label with contract-supplied forbidden character', () => {
    const out = check(
      [{ id: 'n1', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [], name: 'Hello!' }] as never,
      { contract: { schemaVersion: 1, forbiddenLabelChars: '[!@#]' } },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.context?.source).toBe('forbiddenLabelChars');
    expect(out[0]?.context?.label).toBe('Hello!');
  });

  it('flags label that does not match per-type labelPattern', () => {
    const out = check(
      [{ id: 'n1', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [], name: 'lowercase' }] as never,
      { contract: { schemaVersion: 1, types: { inject: { labelPattern: '^[A-Z]' } } } },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.context?.source).toBe('labelPattern');
  });

  it('errors when label exceeds per-type labelMaxLen', () => {
    const out = check(
      [
        { id: 'n1', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [], name: 'too-long-label' },
      ] as never,
      { contract: { schemaVersion: 1, types: { inject: { labelMaxLen: 5 } } } },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.context?.source).toBe('labelMaxLen');
    expect(out[0]?.context?.length).toBe(14);
    expect(out[0]?.context?.max).toBe(5);
  });

  it('errors when a required field is missing', () => {
    const out = check(
      [{ id: 'n1', type: 'function', z: 'tab1', x: 0, y: 0, wires: [], name: 'My fn' }] as never,
      { contract: { schemaVersion: 1, types: { function: { requiredFields: ['func'] } } } },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.context?.source).toBe('requiredFields');
    expect(out[0]?.context?.field).toBe('func');
  });

  it('suppresses substring fallback when a contract is provided', () => {
    const out = check(
      [{ id: 'n1', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [], name: 'TODO Foo' }] as never,
      { contract: { schemaVersion: 1 } },
    );
    expect(out).toEqual([]);
  });
});
