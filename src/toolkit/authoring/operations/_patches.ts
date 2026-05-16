/**
 * Line-based text patches for editing long-string passthrough fields
 * (function-node `func`, ui-template `format`, template-node `template`, etc.)
 * without round-tripping the full content through the wire each call.
 *
 * Patch semantics mirror FlowFuse Expert's `automation/update-node` patches
 * design:
 * - Line numbers are 1-indexed.
 * - `start` and `end` refer to the ORIGINAL content (not running edits).
 * - `op: 'replace'` replaces lines [start..end] (inclusive); end optional.
 * - `op: 'insert'` inserts `content` BEFORE line `start`.
 * - `op: 'delete'` removes lines [start..end] (inclusive).
 * - `content` is split on `\n` — embed multi-line edits naturally.
 *
 * Patches must be non-overlapping. The helper validates and throws on
 * overlap or out-of-range line numbers.
 */

export interface Patch {
  readonly property: string;
  readonly op: 'replace' | 'insert' | 'delete';
  readonly start: number;
  readonly end?: number | undefined;
  readonly content?: string | undefined;
}

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

interface NormalizedPatch {
  readonly op: 'replace' | 'insert' | 'delete';
  readonly start: number;
  readonly end: number;
  readonly content: string;
}

function normalize(patch: Patch, totalLines: number): NormalizedPatch {
  const { op, start } = patch;
  if (!Number.isInteger(start) || start < 1) {
    throw new PatchError(`patch.start must be >= 1 (got ${start})`);
  }
  if (op === 'insert') {
    if (start > totalLines + 1) {
      throw new PatchError(`insert at line ${start} is past end-of-content (${totalLines} lines)`);
    }
    return { op, start, end: start - 1, content: patch.content ?? '' };
  }
  const end = patch.end ?? start;
  if (!Number.isInteger(end) || end < start) {
    throw new PatchError(`patch.end must be >= start (start=${start}, end=${end})`);
  }
  if (end > totalLines) {
    throw new PatchError(`patch end=${end} exceeds total lines (${totalLines})`);
  }
  if (op === 'delete') {
    return { op, start, end, content: '' };
  }
  return { op, start, end, content: patch.content ?? '' };
}

function rangesOverlap(a: NormalizedPatch, b: NormalizedPatch): boolean {
  const aStart = a.start;
  const aEnd = a.op === 'insert' ? a.start - 1 : a.end;
  const bStart = b.start;
  const bEnd = b.op === 'insert' ? b.start - 1 : b.end;
  // Two inserts at the same line are OK only if ordered consistently — but for
  // simplicity, declare them overlapping. Caller can serialize.
  if (a.op === 'insert' && b.op === 'insert') {
    return aStart === bStart;
  }
  if (a.op === 'insert') {
    return aStart > bStart && aStart <= bEnd + 1;
  }
  if (b.op === 'insert') {
    return bStart > aStart && bStart <= aEnd + 1;
  }
  return !(aEnd < bStart || bEnd < aStart);
}

/**
 * Apply a list of patches to a string. All `start`/`end` refer to the
 * ORIGINAL content. Patches must be non-overlapping; throws otherwise.
 */
export function applyPatches(original: string, patches: readonly Patch[]): string {
  if (patches.length === 0) return original;
  const lines = original.split('\n');
  const total = lines.length;

  const normalized = patches.map((p) => normalize(p, total));

  // Check overlap before applying.
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i]!;
      const b = normalized[j]!;
      if (rangesOverlap(a, b)) {
        throw new PatchError(
          `overlapping patches: [${a.op} ${a.start}-${a.end}] vs [${b.op} ${b.start}-${b.end}]`,
        );
      }
    }
  }

  // Apply descending by start so unmodified indices stay valid for remaining patches.
  const sorted = [...normalized].sort((a, b) => b.start - a.start);
  for (const p of sorted) {
    if (p.op === 'insert') {
      const insertLines = p.content.split('\n');
      lines.splice(p.start - 1, 0, ...insertLines);
    } else if (p.op === 'delete') {
      lines.splice(p.start - 1, p.end - p.start + 1);
    } else {
      // replace
      const replaceLines = p.content.split('\n');
      lines.splice(p.start - 1, p.end - p.start + 1, ...replaceLines);
    }
  }

  return lines.join('\n');
}
