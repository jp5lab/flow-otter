import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import lockfile from 'proper-lockfile';
import { z } from 'zod';

import { FlowsJsonSchema, type FlowsJson } from '../../shared/flows-json.js';

export const StagedChangeSchema = z.object({
  flows: FlowsJsonSchema,
  basedOnSnapshotHash: z.string(),
  basedOnRev: z.string().nullable(),
  stagedHash: z.string(),
  stagedAt: z.string(),
  actor: z.string(),
  /**
   * Stable per-process identifier for the agent that staged this change.
   * Used by `deploy_staged_change` to detect when a different concurrent
   * session is about to deploy a stage it didn't author. Optional for
   * back-compat — pre-v0.6.0 staged.json files have no `agent_id`.
   */
  agent_id: z.string().optional(),
  reason: z.string(),
});

export type StagedChange = z.infer<typeof StagedChangeSchema>;

export interface StagedStoreOptions {
  /** Directory holding `staged.json` and the lockfile. */
  dir: string;
  /** Lock retry policy. */
  lock?: { retries?: number; minTimeout?: number; maxTimeout?: number };
}

const FILENAME = 'staged.json';

export class StagedStore {
  constructor(private readonly opts: StagedStoreOptions) {}

  private filePath(): string {
    return path.join(this.opts.dir, FILENAME);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.opts.dir, { recursive: true });
  }

  async write(change: StagedChange): Promise<void> {
    await this.ensureDir();
    await this.withLock(async () => {
      const validated = StagedChangeSchema.parse(change);
      const tmpPath = this.filePath() + '.tmp';
      await writeFile(tmpPath, JSON.stringify(validated, null, 2), { encoding: 'utf8' });
      const { rename } = await import('node:fs/promises');
      await rename(tmpPath, this.filePath());
    });
  }

  async read(): Promise<StagedChange | null> {
    try {
      const raw = await readFile(this.filePath(), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return StagedChangeSchema.parse(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async clear(): Promise<void> {
    await this.withLock(async () => {
      try {
        await unlink(this.filePath());
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    });
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureDir();
    const release = await lockfile.lock(this.opts.dir, {
      retries: this.opts.lock?.retries ?? 5,
      ...(this.opts.lock?.minTimeout !== undefined
        ? { minTimeout: this.opts.lock.minTimeout }
        : { minTimeout: 50 }),
      ...(this.opts.lock?.maxTimeout !== undefined
        ? { maxTimeout: this.opts.lock.maxTimeout }
        : { maxTimeout: 500 }),
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  }
}

export type { FlowsJson };
