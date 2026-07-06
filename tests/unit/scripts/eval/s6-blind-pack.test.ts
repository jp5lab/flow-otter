/**
 * EVAL-4-skeleton — deterministic S6 blind packet pins.
 */
import { describe, expect, it } from 'vitest';

import { assignSides, buildBlindPack } from '../../../../scripts/eval/benchmark/blind-pack.mjs';

const ENTRIES = [
  {
    id: 'entry-1',
    operator_semantics_criteria: [{ id: 'order', description: 'Preserves operator flow order.' }],
  },
  {
    id: 'entry-2',
    operator_semantics_criteria: [{ id: 'alarm', description: 'Preserves alarm branch.' }],
  },
  {
    id: 'entry-3',
    operator_semantics_criteria: [{ id: 'normal', description: 'Preserves normal branch.' }],
  },
];

describe('assignSides', () => {
  it('is deterministic for a given seed', () => {
    expect(
      assignSides(
        ENTRIES.map((e) => e.id),
        'seed-1',
      ),
    ).toEqual(
      assignSides(
        ENTRIES.map((e) => e.id),
        'seed-1',
      ),
    );
  });

  it('changes for a different seed across a reasonable entry set', () => {
    const ids = Array.from({ length: 16 }, (_v, i) => `entry-${i}`);

    expect(assignSides(ids, 'seed-1')).not.toEqual(assignSides(ids, 'seed-2'));
  });

  it('keeps each entry assignment stable under list reordering', () => {
    const first = new Map(assignSides(['a', 'b', 'c'], 'same').map((a) => [a.entryId, a]));
    const reordered = new Map(assignSides(['c', 'a', 'b'], 'same').map((a) => [a.entryId, a]));

    expect(reordered.get('a')).toEqual(first.get('a'));
    expect(reordered.get('b')).toEqual(first.get('b'));
    expect(reordered.get('c')).toEqual(first.get('c'));
  });
});

describe('buildBlindPack', () => {
  it('creates stable packet ids and assignments for the same seed', () => {
    const first = buildBlindPack({ entries: ENTRIES, seed: 'seed-1' });
    const second = buildBlindPack({ entries: ENTRIES, seed: 'seed-1' });

    expect(first).toEqual(second);
    expect(first.packet.entries.map((e) => e.packet_id)).toEqual(
      second.packet.entries.map((e) => e.packet_id),
    );
  });

  it('keeps the answer key separate from the judging packet', () => {
    const { packet, answerKey } = buildBlindPack({ entries: ENTRIES, seed: 'secret-seed' });
    const packetJson = JSON.stringify(packet);

    expect(packetJson).not.toContain('leg');
    expect(packetJson).not.toContain('"A"');
    expect(packetJson).not.toContain('"B"');
    expect(packetJson).not.toContain('secret-seed');
    expect(packetJson).not.toContain('entryId');

    const packetId = packet.entries[0]!.packet_id;
    const key = answerKey[packetId];
    if (key === undefined) throw new Error(`missing answer-key entry for ${packetId}`);
    expect(key.entryId).toBe('entry-1');
    expect(key.left).toMatch(/^[AB]$/u);
    expect(key.right).toMatch(/^[AB]$/u);
    expect(key.seed).toBe('secret-seed');
  });
});
