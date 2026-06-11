/**
 * Docs-presence pin (WSB-6, 2026-06-10 layout-audit fix plan).
 *
 * The fix plan's gates amendment replaced the "CHANGELOG review" fallback
 * with a real unit test: CLIENT_CONFIG.md must document the staging
 * ownership model — `FLOWOTTER_SESSION_ID` was shipped in v0.6.0
 * (container.ts) but stayed undocumented until the 2026-06-10 audit flagged
 * the process-pinned staging friction (e2#8). This test pins the docs so
 * the env var can never silently fall out of the public contract again.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENT_CONFIG_PATH = path.resolve(__dirname, '../../../docs/CLIENT_CONFIG.md');

describe('CLIENT_CONFIG.md staging-ownership coverage', () => {
  const doc = readFileSync(CLIENT_CONFIG_PATH, 'utf8');

  it('documents FLOWOTTER_SESSION_ID', () => {
    expect(doc).toContain('FLOWOTTER_SESSION_ID');
  });

  it('has a staging-ownership section', () => {
    expect(doc).toMatch(/^##\s+Staging ownership/m);
  });

  it('documents the force_takeover recovery path', () => {
    expect(doc).toContain('force_takeover');
  });

  it('documents the hash-equal stale-stage auto-clear (WSB-3 semantics)', () => {
    expect(doc).toContain('staging/auto-cleared-stale-stage');
    expect(doc).toMatch(/byte-identical/);
  });

  it('documents the ownership fields get_staged_change exposes', () => {
    expect(doc).toContain('owned_by_current_session');
    expect(doc).toContain('agent_id');
  });
});
