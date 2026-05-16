import { describe, expect, it } from 'vitest';

import {
  applyPatches,
  PatchError,
} from '../../../../../src/toolkit/authoring/operations/_patches.js';

const ORIG = ['one', 'two', 'three', 'four', 'five'].join('\n');

describe('applyPatches', () => {
  it('returns original when no patches given', () => {
    expect(applyPatches(ORIG, [])).toBe(ORIG);
  });

  it('replace single line', () => {
    const out = applyPatches(ORIG, [{ property: 'x', op: 'replace', start: 2, content: 'TWO' }]);
    expect(out).toBe(['one', 'TWO', 'three', 'four', 'five'].join('\n'));
  });

  it('replace range with multi-line content', () => {
    const out = applyPatches(ORIG, [
      { property: 'x', op: 'replace', start: 2, end: 3, content: 'TWO\nTHREE\nNEW' },
    ]);
    expect(out).toBe(['one', 'TWO', 'THREE', 'NEW', 'four', 'five'].join('\n'));
  });

  it('insert before a line', () => {
    const out = applyPatches(ORIG, [
      { property: 'x', op: 'insert', start: 3, content: 'ZERO\nHALF' },
    ]);
    expect(out).toBe(['one', 'two', 'ZERO', 'HALF', 'three', 'four', 'five'].join('\n'));
  });

  it('insert at end-of-content (start = totalLines + 1)', () => {
    const out = applyPatches(ORIG, [{ property: 'x', op: 'insert', start: 6, content: 'SIX' }]);
    expect(out).toBe(['one', 'two', 'three', 'four', 'five', 'SIX'].join('\n'));
  });

  it('delete range', () => {
    const out = applyPatches(ORIG, [{ property: 'x', op: 'delete', start: 2, end: 4 }]);
    expect(out).toBe(['one', 'five'].join('\n'));
  });

  it('applies multiple non-overlapping patches against ORIGINAL line numbers', () => {
    // delete line 5; replace line 2; insert before line 4
    const out = applyPatches(ORIG, [
      { property: 'x', op: 'delete', start: 5 },
      { property: 'x', op: 'replace', start: 2, content: 'TWO' },
      { property: 'x', op: 'insert', start: 4, content: 'BEFORE-FOUR' },
    ]);
    expect(out).toBe(['one', 'TWO', 'three', 'BEFORE-FOUR', 'four'].join('\n'));
  });

  it('rejects overlapping replace ranges', () => {
    expect(() =>
      applyPatches(ORIG, [
        { property: 'x', op: 'replace', start: 2, end: 4, content: 'X' },
        { property: 'x', op: 'replace', start: 3, end: 5, content: 'Y' },
      ]),
    ).toThrow(PatchError);
  });

  it('rejects out-of-range end', () => {
    expect(() =>
      applyPatches(ORIG, [{ property: 'x', op: 'replace', start: 4, end: 99, content: 'Z' }]),
    ).toThrow(/exceeds total lines/);
  });

  it('rejects start < 1', () => {
    expect(() =>
      applyPatches(ORIG, [{ property: 'x', op: 'replace', start: 0, content: 'Z' }]),
    ).toThrow(/start must be >= 1/);
  });

  it('rejects end < start', () => {
    expect(() =>
      applyPatches(ORIG, [{ property: 'x', op: 'replace', start: 3, end: 2, content: 'Z' }]),
    ).toThrow(/end must be >= start/);
  });

  it('rejects two inserts at the same line', () => {
    expect(() =>
      applyPatches(ORIG, [
        { property: 'x', op: 'insert', start: 3, content: 'A' },
        { property: 'x', op: 'insert', start: 3, content: 'B' },
      ]),
    ).toThrow(PatchError);
  });
});
