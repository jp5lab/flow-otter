import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json.js';

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
