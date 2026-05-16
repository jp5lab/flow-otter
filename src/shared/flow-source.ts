import type { FlowsJson } from './flows-json.js';

export type DeployMode = 'full' | 'nodes' | 'flows' | 'reload';

/**
 * Per-node credentials map: `{ [nodeId]: { [field]: value } }`. Node-RED's
 * runtime/api/flows.js#setFlows reads this from the POST /flows body alongside
 * `flows` and `rev`. File-mode flows.json never carries credentials inline —
 * they live in the sibling `<flowFile>.credentials.json`.
 */
export type Credentials = Record<string, Record<string, unknown>>;

export interface SaveOptions {
  expectedRev?: string;
  deployMode?: DeployMode;
  reason: string;
  credentials?: Credentials;
}

export interface FlowSourceFingerprint {
  sha256: string;
  rev: string | null;
}

export interface FlowSourceDescriptor {
  kind: 'file' | 'adminapi';
  target: string;
}

export interface FlowSourceWarning {
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
}

/**
 * Abstraction over the place flows live: a file on disk (CI / offline tests) or
 * a running Node-RED Admin API (production / integration tests).
 *
 * Same tool code runs against either. Adapters live in `src/adapters/flowsource/`.
 */
export interface FlowSource {
  load(): Promise<{ flows: FlowsJson; rev: string | null }>;
  save(flows: FlowsJson, opts: SaveOptions): Promise<{ rev: string }>;
  fingerprint(): Promise<FlowSourceFingerprint>;
  describe(): FlowSourceDescriptor;
  /**
   * Advisory check for environment-shape problems — e.g. file-source pointed at
   * a path that conflicts with Node-RED's `editorTheme.projects.enabled` flowFile
   * relocation, or admin-api source mismatched with the runtime's flowFile.
   * Returns an empty array when no concerns. Implementations should be cheap
   * (no large I/O, no extra network round-trip beyond what's already needed).
   */
  inspectWarnings(): Promise<readonly FlowSourceWarning[]>;
}
