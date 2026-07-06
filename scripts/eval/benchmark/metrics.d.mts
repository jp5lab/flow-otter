/** Hand-written declarations for metrics.mjs (consumed by the unit suite). */

export interface Position {
  x: number;
  y: number;
}

export interface FlowSpecTab {
  nodes: readonly Record<string, unknown>[];
  comments: readonly Record<string, unknown>[];
  groups: readonly Record<string, unknown>[];
  junctions?: readonly Record<string, unknown>[];
  [key: string]: unknown;
}

export interface FlowSpec {
  tabs: readonly FlowSpecTab[];
  [key: string]: unknown;
}

export interface FlowMetrics {
  nodes: number;
  wires: number;
  backwardWires: number;
  straightLineCrossings: number;
  extent: { w: number; h: number };
}

export declare function stripPositions<T extends FlowSpec>(spec: T): T;
export declare function flowMetrics(
  flows: readonly Record<string, unknown>[],
  tabId: string,
): FlowMetrics;
