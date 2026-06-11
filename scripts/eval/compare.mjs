/**
 * EVAL-1 (pulled forward from EVAL-5) — shared wiring-map / idempotence
 * comparator for eval runs.
 *
 * Two safety post-conditions every replay/canary run asserts:
 *
 * 1. **Wiring-map byte-identity** — a pure reorganization (layout, groups,
 *    comments) must not change the logical graph. `wiringFingerprint`
 *    canonicalizes every node's outgoing `wires` (per output port) and
 *    link-node `links` membership into a key-sorted JSON string; two flows
 *    documents wire-identically iff the fingerprints are byte-equal.
 *
 * 2. **Idempotence via canonical hash** — re-running the same scenario must
 *    produce byte-identical flows.json. `canonicalFlowsHash` mirrors
 *    `canonicalHash` from src/shared/hash.ts EXACTLY (sha256 over key-sorted
 *    4-space-indented JSON); the equivalence is pinned by
 *    tests/unit/scripts/eval/compare.test.ts importing both. This pins
 *    byte-identical compile + `_authoringKey` id preservation end to end.
 *
 * Consumers: EVAL-6 canary steps (Phase 1), EVAL-5 replay scenarios
 * (Phase 2). Pure data-in/data-out — no I/O, no runtime access.
 */

import { createHash } from 'node:crypto';

const INDENT = 4;

function sortKeysReplacer(_key, value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sortedKeys = Object.keys(value).sort();
    const sorted = {};
    for (const k of sortedKeys) sorted[k] = value[k];
    return sorted;
  }
  return value;
}

/** Deterministic JSON: recursively key-sorted, 4-space indent (mirror of src/shared/canonical-json.ts). */
export function canonicalJson(value) {
  return JSON.stringify(value, sortKeysReplacer, INDENT);
}

/** Accepts a flows array (Admin API v1) or a `{flows: [...]}` envelope (v2). */
function flowsArray(flows) {
  if (Array.isArray(flows)) return flows;
  if (flows !== null && typeof flows === 'object' && Array.isArray(flows.flows)) {
    return flows.flows;
  }
  throw new Error('compare: expected a flows.json array or a {flows: [...]} envelope.');
}

/**
 * Canonical wiring map: node id → `{wires?, links?}` for every object that
 * has either. Positions, labels, group membership, z-order — everything
 * non-wiring — is excluded by construction. `links` arrays are sorted
 * (membership, not order, is the semantics); `wires` port arrays keep their
 * port order (port index IS semantic) but the map itself is key-sorted by
 * `canonicalJson`, so node order in the document does not matter.
 */
export function wiringMap(flows) {
  const out = {};
  for (const node of flowsArray(flows)) {
    if (node === null || typeof node !== 'object') continue;
    const id = node.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const entry = {};
    if (Array.isArray(node.wires)) {
      entry.wires = node.wires.map((port) => (Array.isArray(port) ? [...port] : port));
    }
    if (Array.isArray(node.links)) {
      entry.links = [...node.links].sort();
    }
    if (Object.keys(entry).length > 0) out[id] = entry;
  }
  return out;
}

/** Byte-comparable canonical form of the wiring map. */
export function wiringFingerprint(flows) {
  return canonicalJson(wiringMap(flows));
}

/**
 * Diff two wiring maps (as returned by `wiringMap`). Returns `[]` when
 * identical; otherwise one entry per differing node id with the before/after
 * wiring (null = absent on that side).
 */
export function diffWiringMaps(before, after) {
  const diffs = [];
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const id of ids) {
    const a = before[id];
    const b = after[id];
    const ja = a === undefined ? null : canonicalJson(a);
    const jb = b === undefined ? null : canonicalJson(b);
    if (ja !== jb) diffs.push({ id, before: a ?? null, after: b ?? null });
  }
  return diffs;
}

/**
 * Compare two flows documents for wiring byte-identity. Returns
 * `{identical, diffs}` — `diffs` is per-node and empty iff identical.
 */
export function compareWiring(flowsBefore, flowsAfter) {
  const before = wiringMap(flowsBefore);
  const after = wiringMap(flowsAfter);
  const diffs = diffWiringMaps(before, after);
  return { identical: diffs.length === 0, diffs };
}

/**
 * Canonical sha256 of a flows document — MUST stay byte-equivalent to
 * `canonicalHash` in src/shared/hash.ts (pinned by unit test). Two runs are
 * idempotent iff their hashes are equal.
 */
export function canonicalFlowsHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
