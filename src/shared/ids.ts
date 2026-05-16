import { sha256Hex } from './hash.js';

export const NODE_RED_ID_LENGTH = 16;

/**
 * Deterministic 16-hex-character Node-RED-style ID derived from a structural seed.
 * The seed must encode every input that, if changed, should produce a new ID
 * (typically `${tabId}:${nodeKey}`).
 */
export function generateNodeId(seed: string): string {
  return sha256Hex(seed).slice(0, NODE_RED_ID_LENGTH);
}

const MODERN_ID = /^[0-9a-f]{16}$/;
const LEGACY_DOTTED_ID = /^[0-9a-f]{1,16}\.[0-9a-f]{1,8}$/;

export function isNodeRedId(value: unknown): value is string {
  return typeof value === 'string' && (MODERN_ID.test(value) || LEGACY_DOTTED_ID.test(value));
}
