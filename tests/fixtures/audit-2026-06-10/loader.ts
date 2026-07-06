import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUDIT_2026_06_10_FIXTURE_DIR = fileURLToPath(new URL('.', import.meta.url));
export const AUDIT_2026_06_10_HASH_MANIFEST = 'sha256-manifest.json';

export type Audit20260610FixtureName = 'e1-flows.json' | 'e2-flows.json' | 'e1-tab.golden.png';

export interface AuditFixtureLoadOptions {
  readonly fixtureDir?: string;
  readonly manifestPath?: string;
}

export interface AuditFixtureHashManifest {
  readonly schema_version: number;
  readonly algorithm: string;
  readonly files: Readonly<Record<string, string>>;
}

const SHA256_RE = /^[0-9a-f]{64}$/u;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixtureDirOf(options: AuditFixtureLoadOptions): string {
  return options.fixtureDir ?? AUDIT_2026_06_10_FIXTURE_DIR;
}

export function audit20260610FixturePath(
  fixtureName: Audit20260610FixtureName,
  options: AuditFixtureLoadOptions = {},
): string {
  return path.join(fixtureDirOf(options), fixtureName);
}

export function readAudit20260610HashManifest(
  options: AuditFixtureLoadOptions = {},
): AuditFixtureHashManifest {
  const fixtureDir = fixtureDirOf(options);
  const manifestPath =
    options.manifestPath ?? path.join(fixtureDir, AUDIT_2026_06_10_HASH_MANIFEST);
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as AuditFixtureHashManifest;

  if (parsed.schema_version !== 1) {
    throw new Error(`unsupported audit fixture hash manifest schema ${parsed.schema_version}`);
  }
  if (parsed.algorithm !== 'sha256') {
    throw new Error(`unsupported audit fixture hash algorithm '${parsed.algorithm}'`);
  }
  if (typeof parsed.files !== 'object' || parsed.files === null) {
    throw new Error('audit fixture hash manifest must contain a files object');
  }
  for (const [fileName, hash] of Object.entries(parsed.files)) {
    if (!SHA256_RE.test(hash)) {
      throw new Error(`audit fixture '${fileName}' has malformed sha256 '${hash}'`);
    }
  }

  return parsed;
}

export function readAudit20260610FixtureBytes(
  fixtureName: Audit20260610FixtureName,
  options: AuditFixtureLoadOptions = {},
): Buffer {
  const manifest = readAudit20260610HashManifest(options);
  const expected = manifest.files[fixtureName];
  if (expected === undefined) {
    throw new Error(`audit fixture '${fixtureName}' is not sha256-pinned`);
  }

  const filePath = audit20260610FixturePath(fixtureName, options);
  const bytes = readFileSync(filePath);
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(
      `audit fixture sha256 mismatch for '${fixtureName}': expected ${expected}, got ${actual}`,
    );
  }

  return bytes;
}

export function loadAudit20260610FixtureJson(
  fixtureName: Exclude<Audit20260610FixtureName, 'e1-tab.golden.png'>,
  options: AuditFixtureLoadOptions = {},
): unknown {
  return JSON.parse(
    readAudit20260610FixtureBytes(fixtureName, options).toString('utf8'),
  ) as unknown;
}
