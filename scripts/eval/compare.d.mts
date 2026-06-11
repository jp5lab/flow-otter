/** Hand-written declarations for compare.mjs (consumed by the unit suite). */

export interface WiringEntry {
  wires?: string[][];
  links?: string[];
}

export interface WiringDiff {
  id: string;
  before: WiringEntry | null;
  after: WiringEntry | null;
}

export declare function canonicalJson(value: unknown): string;
export declare function wiringMap(flows: unknown): Record<string, WiringEntry>;
export declare function wiringFingerprint(flows: unknown): string;
export declare function diffWiringMaps(
  before: Record<string, WiringEntry>,
  after: Record<string, WiringEntry>,
): WiringDiff[];
export declare function compareWiring(
  flowsBefore: unknown,
  flowsAfter: unknown,
): { identical: boolean; diffs: WiringDiff[] };
export declare function canonicalFlowsHash(value: unknown): string;
