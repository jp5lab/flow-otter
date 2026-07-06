/** Hand-written declarations for blind-pack.mjs (consumed by the unit suite). */

export type S6Leg = 'A' | 'B';

export interface SideAssignment {
  entryId: string;
  left: S6Leg;
  right: S6Leg;
}

export interface BlindPackEntryInput {
  id: string;
  operator_semantics_criteria: readonly unknown[];
  [key: string]: unknown;
}

export interface BlindPacket {
  schema_version: 1;
  benchmark: string;
  entries: readonly {
    packet_id: string;
    left: { artifact_ref: string };
    right: { artifact_ref: string };
    operator_semantics_criteria: readonly unknown[];
  }[];
}

export type BlindAnswerKey = Record<
  string,
  { entryId: string; left: S6Leg; right: S6Leg; seed: string }
>;

export declare function assignSides(entryIds: readonly string[], seed: string): SideAssignment[];
export declare function buildBlindPack(opts: {
  entries: readonly BlindPackEntryInput[];
  seed: string;
}): { packet: BlindPacket; answerKey: BlindAnswerKey };
