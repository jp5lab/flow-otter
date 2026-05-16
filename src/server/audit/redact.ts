const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /token/i,
  /password/i,
  /authorization/i,
  /credential/i,
  /api[_-]?key/i,
  /secret/i,
  /node_red_auth/i,
];

/**
 * Value patterns to scrub from STRING values. Match anywhere in the value,
 * not just whole-string — a `Bearer …` embedded mid-sentence in an error
 * message must still be redacted. Each pattern's match region is replaced
 * with `REDACTED`, leaving non-secret surrounding text intact.
 *
 * Order matters: the JWT pattern is checked before the long-hex pattern
 * because a JWT's three segments individually look like hex blobs and would
 * otherwise be over-aggressively chewed up.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /Bearer\s+\S+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT-shaped (anywhere)
  /[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // generic JWT-shaped
  /\b[A-Fa-f0-9]{32,}\b/g, // long hex blobs (anywhere, word-bounded)
];

export const REDACTED = '***REDACTED***';

const ALLOW_AS_KEYS = new Set(['args_hash', 'snapshot_before', 'snapshot_after']);

function isSecretKey(key: string): boolean {
  for (const pat of SECRET_KEY_PATTERNS) {
    if (pat.test(key)) return true;
  }
  return false;
}

function scrubValue(value: string): string {
  let out = value;
  for (const pat of SECRET_VALUE_PATTERNS) {
    out = out.replace(pat, REDACTED);
  }
  return out;
}

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return scrubValue(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (ALLOW_AS_KEYS.has(k)) {
        out[k] = v;
        continue;
      }
      if (isSecretKey(k)) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = redact(v);
    }
    return out;
  }
  return value;
}
