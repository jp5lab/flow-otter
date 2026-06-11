/** Hand-written declarations for fidelity.mjs (consumed by TS tests/harnesses). */

export declare const FIDELITY_TOLERANCE_PX: number;
export declare const JUNCTION_PAIR_RADIUS_PX: number;
export declare const EDITOR_DERIVED_KINDS: readonly string[];

/** Structurally identical to RenderGeometryPort (src/toolkit/render/svg.ts). */
export interface FidelityPort {
  kind: 'input' | 'output';
  index: number;
  x: number;
  y: number;
}

/** Structurally identical to RenderGeometryEntry (frozen contract #1). */
export interface FidelityEntry {
  id: string;
  kind: 'node' | 'junction' | 'group' | 'comment';
  x: number;
  y: number;
  w: number;
  h: number;
  ports: FidelityPort[];
}

export declare function editorComparableEntries(entries: FidelityEntry[]): FidelityEntry[];

export interface FidelityCorner {
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  x: number;
  y: number;
}

export declare function cornersOf(
  entry: Pick<FidelityEntry, 'x' | 'y' | 'w' | 'h'>,
): [FidelityCorner, FidelityCorner, FidelityCorner, FidelityCorner];

export interface FidelityEntryRef {
  id: string;
  kind: FidelityEntry['kind'];
  x: number;
  y: number;
}

export interface FidelityPairing {
  pairs: Array<{ expected: FidelityEntry; actual: FidelityEntry }>;
  missing: FidelityEntryRef[];
  unexpected: FidelityEntryRef[];
}

export interface FidelityOffset {
  x: number;
  y: number;
}

export declare function pairEntries(
  expected: FidelityEntry[],
  actual: FidelityEntry[],
  opts?: { junctionPairRadiusPx?: number; offset?: FidelityOffset },
): FidelityPairing;

export interface FidelityMismatch {
  id: string;
  kind: FidelityEntry['kind'];
  /** `corner:<name>`, `port:<kind>[<index>]` or `port-count:<kind>`. */
  check: string;
  expected: { x: number; y: number } | { count: number };
  actual: { x: number; y: number } | { count: number };
  dx: number | null;
  dy: number | null;
}

export interface FidelityResult {
  pass: boolean;
  tolerance_px: number;
  entries_compared: number;
  corners_checked: number;
  ports_checked: number;
  mismatches: FidelityMismatch[];
  missing: FidelityEntryRef[];
  unexpected: FidelityEntryRef[];
}

export declare function compareGeometry(
  expected: FidelityEntry[],
  actual: FidelityEntry[],
  opts?: { tolerancePx?: number; junctionPairRadiusPx?: number; offset?: FidelityOffset },
): FidelityResult;

export declare function formatFidelityReport(result: FidelityResult): string;

/** Browser-side functions — serialize via `fn.toString()`, never call in Node. */
export declare function pageEditorReady(): boolean;
export declare function pageGeometryDump(): RawEditorDump;

export interface RawEditorDumpNode {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  inputPorts: Array<{ x: number; y: number } | null>;
  outputPorts: Array<{ x: number; y: number } | null>;
}

export interface RawEditorDump {
  version: string;
  activeWorkspace: string;
  nodes: RawEditorDumpNode[];
  groups: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  junctions: Array<{ id: string; x: number; y: number; w: number | null; h: number | null }>;
}

export declare function normalizeEditorDump(raw: RawEditorDump): FidelityEntry[];

export interface CapturedEditorGeometry {
  nodeRedVersion: string;
  activeWorkspace: string;
  entries: FidelityEntry[];
  raw: RawEditorDump;
}

export declare function captureEditorGeometry(
  session: import('./cdp.mjs').CdpSession,
  opts?: { tabId?: string; timeoutMs?: number; pollMs?: number },
): Promise<CapturedEditorGeometry>;

export interface FixtureFreshnessFixture {
  nodeRedVersion: string;
  capturedAt?: string;
  [key: string]: unknown;
}

export interface FixtureFreshnessResult {
  fresh: boolean;
  rule:
    | 'exact'
    | 'patch-drift'
    | 'nodered-4.0-assumption'
    | 'stale'
    | 'no-fixtures'
    | 'invalid-fixture'
    | 'invalid-live-version';
  matched: FixtureFreshnessFixture | null;
  reason: string;
}

export declare function checkFixtureFreshness(args: {
  liveVersion: string;
  fixtures: FixtureFreshnessFixture[];
}): FixtureFreshnessResult;
