import { describe, expect, it } from 'vitest';

import { REDACTED, redact } from '../../../../src/server/audit/redact.js';

describe('redact', () => {
  it('redacts top-level secret-like keys', () => {
    const out = redact({ token: 'abc123', other: 'fine' });
    expect((out as Record<string, unknown>)['token']).toBe(REDACTED);
    expect((out as Record<string, unknown>)['other']).toBe('fine');
  });

  it('redacts nested secret-like keys', () => {
    const out = redact({ http: { authorization: 'Bearer xxx' } });
    expect((out as { http: { authorization: string } }).http.authorization).toBe(REDACTED);
  });

  it('redacts bearer-token-shaped strings even at non-secret keys', () => {
    const out = redact({ note: 'Bearer eyJhbGciOiJIUzI1NiJ9' });
    expect((out as { note: string }).note).toBe(REDACTED);
  });

  it('does not corrupt args_hash or snapshot ids', () => {
    const allow = {
      args_hash: 'a'.repeat(64),
      snapshot_before: '2026-05-01T00-00-00-000Z__test__abc.json',
    };
    const out = redact(allow);
    expect((out as Record<string, unknown>)['args_hash']).toBe(allow.args_hash);
    expect((out as Record<string, unknown>)['snapshot_before']).toBe(allow.snapshot_before);
  });

  it('red-team: every event-path field cannot leak a planted secret', () => {
    const planted = 'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig';
    const event = {
      ts: '2026-05-01T00:00:00Z',
      actor: 'a',
      tool: 't',
      tier: 'deploy',
      args_hash: 'h',
      result: 'success',
      duration_ms: 12,
      // Inject the secret at every plausible field
      error: planted,
      diff_summary: { wires_added: 1, nested_token: planted },
      flow_source: 'http://example.com',
      auth_token: planted,
      credentials: { token: planted, password: planted },
    };
    const json = JSON.stringify(redact(event));
    expect(json).not.toContain(planted);
    expect(json).not.toContain('eyJhbGciOiJSUzI1NiJ9.payload.sig');
  });
});
