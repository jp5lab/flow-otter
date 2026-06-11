/**
 * WSB-1 (SD2) — structured error payloads through stdio.
 *
 * Per-branch assertions on the pure serializer. The over-the-wire regression
 * (real stdio transport, e2 "1 validation error(s)" defect) lives in
 * tests/integration/tool-error-transport.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { DriftError } from '../../../../src/adapters/nodered/errors.js';
import { ToolBlockedError, ValidationFailedError } from '../../../../src/server/tools/_tool.js';
import {
  DIAGNOSTICS_CAP,
  toolErrorContent,
  toolErrorPayload,
} from '../../../../src/server/transport/tool-error.js';

/** Extract and parse the JSON block (everything after the first blank line). */
function parseJsonBlock(text: string): unknown {
  const idx = text.indexOf('\n\n');
  expect(idx, 'content must contain a blank line separating prose from JSON').toBeGreaterThan(0);
  return JSON.parse(text.slice(idx + 2));
}

describe('toolErrorContent — shape and legacy first line', () => {
  it('returns exactly one text content block', () => {
    const content = toolErrorContent('add_node', new Error('boom'));
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('text');
  });

  it("keeps the legacy human-readable first line byte-identical: Tool '<name>' failed: <message>", () => {
    const err = new ValidationFailedError('add_node produced flows with 1 validation error(s).', [
      { rule: 'off-canvas' },
    ]);
    const content = toolErrorContent('add_node', err);
    expect(content[0]!.text.split('\n')[0]).toBe(
      "Tool 'add_node' failed: add_node produced flows with 1 validation error(s).",
    );
  });

  it('appends a parseable JSON block after a blank line', () => {
    const content = toolErrorContent('get_flow', new Error('boom'));
    const payload = parseJsonBlock(content[0]!.text) as { error: Record<string, unknown> };
    expect(payload.error['name']).toBe('Error');
    expect(payload.error['message']).toBe('boom');
  });

  it('the JSON block is pretty-printed with 2-space indentation', () => {
    const content = toolErrorContent('get_flow', new Error('boom'));
    const text = content[0]!.text;
    const json = text.slice(text.indexOf('\n\n') + 2);
    expect(json).toBe(JSON.stringify(JSON.parse(json), null, 2));
  });
});

describe('toolErrorPayload — ValidationFailedError branch', () => {
  it('carries diagnostics verbatim', () => {
    const diagnostics = [
      {
        severity: 'error',
        rule: 'off-canvas',
        message: "Node 'n1' position (99999, 100) is off-canvas (bounds 0..2400 × 0..1600).",
        nodeId: 'n1',
        tabId: 't1',
        context: { x: 99999, y: 100, maxX: 2400, maxY: 1600 },
      },
    ];
    const payload = toolErrorPayload(
      new ValidationFailedError('add_node produced flows with 1 validation error(s).', diagnostics),
    );
    expect(payload.error.name).toBe('ValidationFailedError');
    expect(payload.error.message).toBe('add_node produced flows with 1 validation error(s).');
    expect(payload.error.diagnostics).toEqual(diagnostics);
    expect(payload.error).not.toHaveProperty('diagnostics_truncated');
    expect(payload.error).not.toHaveProperty('expected_hash');
    expect(payload.error).not.toHaveProperty('actual_hash');
  });

  it(`caps diagnostics at ${DIAGNOSTICS_CAP} with a truncation marker`, () => {
    const diagnostics = Array.from({ length: DIAGNOSTICS_CAP + 10 }, (_, i) => ({
      rule: 'off-canvas',
      message: `diag ${i}`,
    }));
    const payload = toolErrorPayload(new ValidationFailedError('many errors', diagnostics));
    expect(payload.error.diagnostics).toHaveLength(DIAGNOSTICS_CAP);
    expect(payload.error.diagnostics).toEqual(diagnostics.slice(0, DIAGNOSTICS_CAP));
    expect(payload.error.diagnostics_truncated).toBe(10);
  });

  it(`emits no truncation marker at exactly ${DIAGNOSTICS_CAP} diagnostics`, () => {
    const diagnostics = Array.from({ length: DIAGNOSTICS_CAP }, (_, i) => ({ i }));
    const payload = toolErrorPayload(new ValidationFailedError('at cap', diagnostics));
    expect(payload.error.diagnostics).toHaveLength(DIAGNOSTICS_CAP);
    expect(payload.error).not.toHaveProperty('diagnostics_truncated');
  });

  it('carries an empty diagnostics array verbatim (not dropped)', () => {
    const payload = toolErrorPayload(new ValidationFailedError('tab not found', []));
    expect(payload.error.diagnostics).toEqual([]);
  });
});

describe('toolErrorPayload — DriftError branch', () => {
  it('carries expected_hash and actual_hash', () => {
    const payload = toolErrorPayload(
      new DriftError('aaaa1111', 'bbbb2222', 'Runtime flows changed since the staged change.'),
    );
    expect(payload.error.name).toBe('DriftError');
    expect(payload.error.message).toBe('Runtime flows changed since the staged change.');
    expect(payload.error.expected_hash).toBe('aaaa1111');
    expect(payload.error.actual_hash).toBe('bbbb2222');
    expect(payload.error).not.toHaveProperty('diagnostics');
  });
});

describe('toolErrorPayload — generic branch', () => {
  it('ToolBlockedError → name + message only', () => {
    const payload = toolErrorPayload(new ToolBlockedError('A staged change is already pending.'));
    expect(payload).toEqual({
      error: { name: 'ToolBlockedError', message: 'A staged change is already pending.' },
    });
  });

  it('plain Error → name + message only', () => {
    const payload = toolErrorPayload(new Error('boom'));
    expect(payload).toEqual({ error: { name: 'Error', message: 'boom' } });
  });

  it('non-Error throwable (string) → name Error, message String(err)', () => {
    const payload = toolErrorPayload('exploded');
    expect(payload).toEqual({ error: { name: 'Error', message: 'exploded' } });
  });

  it('duck-typed name survives even without class identity', () => {
    const payload = toolErrorPayload({ name: 'AuthFailedError', message: 'denied' });
    expect(payload.error.name).toBe('AuthFailedError');
  });

  it('ValidationFailedError-named object WITHOUT an array diagnostics field degrades to generic', () => {
    const payload = toolErrorPayload({
      name: 'ValidationFailedError',
      message: 'shape off',
      diagnostics: 'not-an-array',
    });
    expect(payload).toEqual({ error: { name: 'ValidationFailedError', message: 'shape off' } });
  });

  // WSB-5 replaces this test when the BatchOpError branch is added: the
  // payload then gains failed_op_index / failed_op. Until then a name-only
  // 'BatchOpError' falls through to the generic branch — pinned here so the
  // flip is deliberate. See the contract in src/server/transport/tool-error.ts.
  it("'BatchOpError' (does not exist yet) currently falls through to the generic branch", () => {
    const err = Object.assign(new Error('op 3 failed'), {
      name: 'BatchOpError',
      failedOpIndex: 3,
      failedOp: { op: 'add_node' },
    });
    const payload = toolErrorPayload(err);
    expect(payload).toEqual({ error: { name: 'BatchOpError', message: 'op 3 failed' } });
  });
});

describe('toolErrorContent — defensive serialization', () => {
  it('degrades loudly when diagnostics are not JSON-serializable', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const err = new ValidationFailedError('circular diagnostics', [circular]);
    const content = toolErrorContent('add_node', err);
    expect(content[0]!.text.split('\n')[0]).toBe("Tool 'add_node' failed: circular diagnostics");
    const payload = parseJsonBlock(content[0]!.text) as { error: Record<string, unknown> };
    expect(payload.error['name']).toBe('ValidationFailedError');
    expect(payload.error['serialization_failed']).toBe(true);
    expect(payload.error).not.toHaveProperty('diagnostics');
  });
});
