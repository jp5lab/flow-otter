export interface CredentialPattern {
  readonly name: string;
  readonly severity: 'error' | 'warning';
  readonly regex: RegExp;
}

export const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = Object.freeze([
  {
    name: 'bearer-jwt',
    severity: 'error',
    regex: /Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  },
  {
    name: 'github-pat',
    severity: 'error',
    regex: /\bgh[ps]_[A-Za-z0-9]{30,}\b/,
  },
  {
    name: 'aws-access-key',
    severity: 'error',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: 'slack-token',
    severity: 'error',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  },
  {
    name: 'mqtt-url-credentials',
    severity: 'error',
    regex: /\bmqtts?:\/\/[^:\s/]+:[^@\s/]+@/,
  },
  {
    name: 'http-url-credentials',
    severity: 'error',
    regex: /\bhttps?:\/\/[^:\s/]+:[^@\s/]+@/,
  },
  {
    name: 'generic-hex-blob',
    severity: 'warning',
    regex: /\b[a-f0-9]{32,}\b/i,
  },
] satisfies readonly CredentialPattern[]);
