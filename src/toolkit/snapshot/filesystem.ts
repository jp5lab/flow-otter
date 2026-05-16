import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalHash } from '../../shared/hash.js';
import { FlowsJsonSchema, type FlowsJson } from '../../shared/flows-json.js';

import {
  filenameFor,
  manifestToRef,
  SnapshotManifestSchema,
  type SnapshotManifest,
  type SnapshotRef,
} from './manifest.js';
import {
  type RetentionPolicy,
  type SnapshotFilter,
  type SnapshotInput,
  type SnapshotPayload,
  type SnapshotStore,
} from './store.js';

interface PersistedShape {
  manifest: SnapshotManifest;
  flows: FlowsJson;
}

export interface FilesystemSnapshotStoreOptions {
  /** Root directory under which `snapshots/<env>/` lives. */
  rootDir: string;
  /**
   * Maximum number of snapshots to keep per env. When set, `save()` prunes
   * the oldest excess after each write. Snapshots tagged with any entry of
   * `retentionProtectTags` are skipped by the prune step.
   */
  retentionKeepLast?: number;
  retentionProtectTags?: readonly string[];
}

export class FilesystemSnapshotStore implements SnapshotStore {
  constructor(private readonly opts: FilesystemSnapshotStoreOptions) {}

  private envDir(env: string): string {
    return path.join(this.opts.rootDir, 'snapshots', env);
  }

  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  async save(input: SnapshotInput): Promise<SnapshotRef> {
    const sha256 = canonicalHash(input.flows);
    const id = filenameFor(input.env, input.takenAt, sha256);
    const dir = this.envDir(input.env);
    await this.ensureDir(dir);
    const manifest: SnapshotManifest = {
      id,
      env: input.env,
      createdAt: input.takenAt,
      sha256,
      rev: input.rev,
      actor: input.actor,
      reason: input.reason,
      tags: [...(input.tags ?? [])],
      ...(input.serverVersion !== undefined ? { serverVersion: input.serverVersion } : {}),
    };
    const payload: PersistedShape = { manifest, flows: input.flows };
    await writeFile(path.join(dir, id), JSON.stringify(payload, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
    });
    if (typeof this.opts.retentionKeepLast === 'number' && this.opts.retentionKeepLast > 0) {
      await this.prune({
        env: input.env,
        keepLast: this.opts.retentionKeepLast,
        ...(this.opts.retentionProtectTags !== undefined
          ? { protectTags: this.opts.retentionProtectTags }
          : {}),
      });
    }
    return manifestToRef(manifest);
  }

  async load(ref: SnapshotRef | string): Promise<SnapshotPayload> {
    const { env, id } = this.refOrId(ref);
    const filePath = path.join(this.envDir(env), id);
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const shape = z_object_persistedShape(parsed);
    return { manifest: shape.manifest, flows: shape.flows };
  }

  async list(filter: SnapshotFilter = {}): Promise<SnapshotRef[]> {
    const targetEnvs = filter.env !== undefined ? [filter.env] : await this.listEnvs();
    const refs: SnapshotRef[] = [];
    for (const env of targetEnvs) {
      const dir = this.envDir(env);
      let entries: string[] = [];
      try {
        entries = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        try {
          const raw = await readFile(path.join(dir, entry), 'utf8');
          const parsed = JSON.parse(raw) as unknown;
          const shape = z_object_persistedShape(parsed);
          if (filter.tag !== undefined && !shape.manifest.tags.includes(filter.tag)) continue;
          refs.push(manifestToRef(shape.manifest));
        } catch {
          // skip unreadable file
        }
      }
    }
    refs.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1,
    );
    return filter.limit !== undefined ? refs.slice(0, filter.limit) : refs;
  }

  async latest(env?: string): Promise<SnapshotRef | null> {
    const filter: SnapshotFilter = env !== undefined ? { env, limit: 1 } : { limit: 1 };
    const list = await this.list(filter);
    return list[0] ?? null;
  }

  async prune(policy: RetentionPolicy): Promise<{ removed: SnapshotRef[] }> {
    const protectTags = new Set(policy.protectTags ?? []);
    const targetEnvs = policy.env !== undefined ? [policy.env] : await this.listEnvs();
    const removed: SnapshotRef[] = [];
    for (const env of targetEnvs) {
      const refs = await this.list({ env });
      const ordered = refs.slice();
      const keepers = new Set<string>();
      for (let i = 0; i < ordered.length && i < policy.keepLast; i++) {
        const item = ordered[i];
        if (item) keepers.add(item.id);
      }
      for (const ref of ordered) {
        if (keepers.has(ref.id)) continue;
        if (ref.tags.some((t) => protectTags.has(t))) continue;
        await unlink(path.join(this.envDir(env), ref.id));
        removed.push(ref);
      }
    }
    return { removed };
  }

  async fingerprint(ref: SnapshotRef | string): Promise<string> {
    if (typeof ref === 'object' && 'sha256' in ref) return ref.sha256;
    const payload = await this.load(ref);
    return payload.manifest.sha256;
  }

  private async listEnvs(): Promise<string[]> {
    const dir = path.join(this.opts.rootDir, 'snapshots');
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  private refOrId(ref: SnapshotRef | string): { env: string; id: string } {
    if (typeof ref === 'string') {
      // Filename embeds env between underscores: "<ts>__<env>__<hash>.json"
      const match = /^.+?__(.+?)__.+\.json$/.exec(ref);
      if (!match || !match[1]) {
        throw new Error(`Cannot infer env from snapshot id '${ref}'.`);
      }
      return { env: match[1], id: ref };
    }
    return { env: ref.env, id: ref.id };
  }
}

function z_object_persistedShape(parsed: unknown): PersistedShape {
  const obj = parsed as { manifest?: unknown; flows?: unknown };
  const manifest = SnapshotManifestSchema.parse(obj.manifest);
  const flows = FlowsJsonSchema.parse(obj.flows);
  return { manifest, flows };
}
