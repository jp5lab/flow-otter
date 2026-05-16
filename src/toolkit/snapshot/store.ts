import type { FlowsJson } from '../../shared/flows-json.js';

import type { SnapshotManifest, SnapshotRef } from './manifest.js';

export interface SnapshotInput {
  readonly flows: FlowsJson;
  readonly rev: string | null;
  readonly env: string;
  readonly actor: string;
  readonly reason: string;
  /** ISO 8601 timestamp. Injected by the caller — toolkit code does not read the clock. */
  readonly takenAt: string;
  readonly tags?: readonly string[];
  readonly serverVersion?: string;
}

export interface SnapshotPayload {
  readonly flows: FlowsJson;
  readonly manifest: SnapshotManifest;
}

export interface SnapshotFilter {
  readonly env?: string;
  readonly tag?: string;
  readonly limit?: number;
}

export interface RetentionPolicy {
  readonly env?: string;
  readonly keepLast: number;
  /** Tag values whose snapshots are never pruned regardless of age. */
  readonly protectTags?: readonly string[];
}

export interface SnapshotStore {
  save(input: SnapshotInput): Promise<SnapshotRef>;
  load(ref: SnapshotRef | string): Promise<SnapshotPayload>;
  list(filter?: SnapshotFilter): Promise<SnapshotRef[]>;
  latest(env?: string): Promise<SnapshotRef | null>;
  prune(policy: RetentionPolicy): Promise<{ removed: SnapshotRef[] }>;
  fingerprint(ref: SnapshotRef | string): Promise<string>;
}
