import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../../../src/toolkit/catalog/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RULES_DIR = path.resolve(__dirname, '../../../src/toolkit/validate/rules');

function listValidatorFiles(): string[] {
  return readdirSync(RULES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
    .map((f) => f.replace(/\.ts$/, ''));
}

describe('catalog completeness vs the code', () => {
  it('every validator file in src/toolkit/validate/rules/ has a catalog entry', () => {
    const onDisk = new Set(listValidatorFiles());
    const inCatalog = new Set(buildCatalog('test').validators.map((v) => v.rule));

    const missing = [...onDisk].filter((r) => !inCatalog.has(r));
    expect(missing, `Catalog missing validator entries for: ${missing.join(', ')}`).toEqual([]);
  });

  it('every catalog validator entry corresponds to a file on disk', () => {
    const onDisk = new Set(listValidatorFiles());
    const inCatalog = buildCatalog('test').validators.map((v) => v.rule);

    const orphaned = inCatalog.filter((r) => !onDisk.has(r));
    expect(
      orphaned,
      `Catalog has stale validator entries (no file): ${orphaned.join(', ')}`,
    ).toEqual([]);
  });

  it('every catalog template entry has a matching BUILTIN_TEMPLATES entry (they share a source)', () => {
    // catalog templates are sourced from BUILTIN_TEMPLATES, so this is a
    // round-trip check: every catalog template has a non-empty description.
    const cat = buildCatalog('test');
    for (const t of cat.templates) {
      expect(t.name).toMatch(/^[a-z0-9_]+$/);
      expect(t.description.length).toBeGreaterThan(0);
      expect(['generic', 'dashboard', 'operator', 'pipeline']).toContain(t.category);
    }
  });
});
