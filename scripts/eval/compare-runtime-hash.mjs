#!/usr/bin/env node
/**
 * EVAL-6 — byte-compare the LIVE runtime flows against an expected canonical
 * hash, using the shared comparator (scripts/eval/compare.mjs — duplicate
 * comparators are banned).
 *
 * The S4 canary's rollback drill runs this as an exec step:
 *
 *   node scripts/eval/compare-runtime-hash.mjs $PREV.restored_hash
 *
 * where `$PREV.restored_hash` is `rollback_last_change`'s output (the
 * canonical sha256 of the restored snapshot's flows). A pass proves the
 * rollback restored the runtime BYTE-IDENTICALLY — the S4 criterion
 * "`rollback_last_change` restores byte-identical snapshot".
 *
 * Reads NODE_RED_BASE_URL (default http://localhost:1880 — sterile stack
 * only). Exit 0 = hashes equal; exit 1 = mismatch; exit 2 = usage/fetch
 * error. Run from the repo root (the canary runner does).
 */
import { canonicalFlowsHash } from './compare.mjs';

const expected = process.argv[2];
if (expected === undefined || !/^[0-9a-f]{64}$/.test(expected)) {
  console.error(
    `usage: node scripts/eval/compare-runtime-hash.mjs <sha256-hex> (got: ${String(expected)})`,
  );
  process.exit(2);
}

const base = process.env.NODE_RED_BASE_URL ?? 'http://localhost:1880';
const res = await fetch(`${base}/flows`, { headers: { Accept: 'application/json' } });
if (!res.ok) {
  console.error(`GET ${base}/flows -> HTTP ${res.status}`);
  process.exit(2);
}
const actual = canonicalFlowsHash(await res.json());
if (actual === expected) {
  console.log(`restore-byte-identical ${actual}`);
  process.exit(0);
}
console.log(`HASH-MISMATCH expected ${expected} actual ${actual}`);
process.exit(1);
