/**
 * Canonical JSON serialization: deterministic key order + 4-space indent.
 *
 * Used as the single source of truth for byte-level equality of `flows.json` documents.
 * Idempotency invariants depend on this module being the only place keys get sorted.
 */

const INDENT = 4;

function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const original = value as Record<string, unknown>;
    const sortedKeys = Object.keys(original).sort();
    const sorted: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      sorted[k] = original[k];
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortKeysReplacer, INDENT);
}

export function canonicalize<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
