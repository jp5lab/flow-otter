import { z } from 'zod';

export const SnapshotManifestSchema = z.object({
  id: z.string(),
  env: z.string(),
  createdAt: z.string(),
  sha256: z.string(),
  rev: z.string().nullable(),
  actor: z.string(),
  reason: z.string(),
  tags: z.array(z.string()).default([]),
  serverVersion: z.string().optional(),
});

export type SnapshotManifest = z.infer<typeof SnapshotManifestSchema>;

export interface SnapshotRef {
  readonly id: string;
  readonly env: string;
  readonly createdAt: string;
  readonly sha256: string;
  readonly rev: string | null;
  readonly tags: readonly string[];
}

export function manifestToRef(m: SnapshotManifest): SnapshotRef {
  return {
    id: m.id,
    env: m.env,
    createdAt: m.createdAt,
    sha256: m.sha256,
    rev: m.rev,
    tags: m.tags,
  };
}

const FILE_RE = /[^A-Za-z0-9._-]+/g;

export function filenameFor(env: string, createdAt: string, sha256: string): string {
  const sanitizedEnv = env.replace(FILE_RE, '_');
  const sanitizedTs = createdAt.replace(FILE_RE, '-');
  return `${sanitizedTs}__${sanitizedEnv}__${sha256.slice(0, 12)}.json`;
}
