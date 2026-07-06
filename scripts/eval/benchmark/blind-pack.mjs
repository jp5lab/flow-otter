/**
 * EVAL-4-skeleton — deterministic blinded packet plumbing (fix plan §3 EVAL-4).
 *
 * Judges receive packet ids, left/right artifact placeholders, and operator
 * semantics criteria only. The seeded A/B side assignment stays in the answer
 * key, which the runner writes only to an ignored eval-results location.
 */

import { createHash } from 'node:crypto';

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sideFor(entryId, seed) {
  const byte = Number.parseInt(sha256Hex(`s6-side\0${seed}\0${entryId}`).slice(0, 2), 16);
  return byte % 2 === 0 ? 'A' : 'B';
}

function packetIdFor(entryId, seed) {
  return `s6-${sha256Hex(`s6-packet\0${seed}\0${entryId}`).slice(0, 16)}`;
}

export function assignSides(entryIds, seed) {
  return entryIds.map((entryId) => {
    const left = sideFor(entryId, seed);
    return { entryId, left, right: left === 'A' ? 'B' : 'A' };
  });
}

export function buildBlindPack({ entries, seed }) {
  const assignments = new Map(
    assignSides(
      entries.map((e) => e.id),
      seed,
    ).map((a) => [a.entryId, a]),
  );
  const answerKey = {};
  const packetEntries = entries.map((entry) => {
    const assignment = assignments.get(entry.id);
    const packetId = packetIdFor(entry.id, seed);
    answerKey[packetId] = {
      entryId: entry.id,
      left: assignment.left,
      right: assignment.right,
      seed,
    };
    return {
      packet_id: packetId,
      left: { artifact_ref: `artifacts/${packetId}/left` },
      right: { artifact_ref: `artifacts/${packetId}/right` },
      operator_semantics_criteria: entry.operator_semantics_criteria,
    };
  });

  return {
    packet: {
      schema_version: 1,
      benchmark: 's6-blind-judging-packet',
      entries: packetEntries,
    },
    answerKey,
  };
}
