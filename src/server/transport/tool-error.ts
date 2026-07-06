/**
 * Structured tool-error serialization for the stdio transport (WSB-1, SD2).
 *
 * Why this exists: the 2026-06-10 layout audit (e2) caught the transport
 * collapsing rich errors to their message string — the agent saw
 * "add_node produced flows with 1 validation error(s)." with the actual
 * diagnostics dropped on the floor. Every error now crosses stdio as ONE text
 * content block:
 *
 *   line 1..n : the legacy human-readable text, byte-identical to the old
 *               format — `Tool '<name>' failed: <message>`
 *   blank line
 *   JSON block: the machine-readable cause (pretty-printed, 2-space)
 *
 * ## Payload contract (ADDITIVE — fields are only ever added, never renamed
 * ## or reshaped; consumers must tolerate unknown fields)
 *
 * ```json
 * {
 *   "error": {
 *     "name": "string — err.name, or 'Error' for non-Error throwables",
 *     "message": "string — err.message, or String(err)",
 *     "diagnostics": "unknown[] — ValidationFailedError only; verbatim, capped at DIAGNOSTICS_CAP",
 *     "diagnostics_truncated": "number — count of diagnostics omitted beyond the cap (truncation marker; absent when nothing was cut)",
 *     "expected_hash": "string — DriftError only",
 *     "actual_hash": "string — DriftError only",
 *     "failed_op_index": "number — BatchOpError only (WSB-5, see below)",
 *     "failed_op": "unknown — BatchOpError only (WSB-5, see below)",
 *     "serialization_failed": "true — defensive: enrichment was not JSON-serializable and was dropped"
 *   }
 * }
 * ```
 *
 * Branch dispatch is NAME-BASED (`err.name`), matching `classifyError` in
 * `src/server/tools/_tool.ts`, with structural validation of each field before
 * it is emitted. Class identity is deliberately not required, so errors that
 * cross module/realm boundaries still serialize correctly.
 *
 * Current branches:
 * - `ValidationFailedError` (src/server/tools/_tool.ts) → `diagnostics`
 *   verbatim, capped at {@link DIAGNOSTICS_CAP} with `diagnostics_truncated`
 *   as the truncation marker.
 * - `DriftError` (src/adapters/nodered/errors.ts) → `expected_hash` /
 *   `actual_hash`.
 * - `BatchOpError` (src/server/tools/_tool.ts) → `failed_op_index` /
 *   `failed_op`, plus wrapped diagnostics when present.
 * - everything else → `name` + `message` only.
 */

/** Maximum number of diagnostics serialized into one error payload. */
export const DIAGNOSTICS_CAP = 50;

export interface ToolErrorPayload {
  readonly error: {
    readonly name: string;
    readonly message: string;
    readonly diagnostics?: readonly unknown[];
    /** Truncation marker: how many diagnostics were omitted beyond the cap. */
    readonly diagnostics_truncated?: number;
    readonly expected_hash?: string;
    readonly actual_hash?: string;
    /** Reserved for BatchOpError (WSB-5) — see file header. */
    readonly failed_op_index?: number;
    /** Reserved for BatchOpError (WSB-5) — see file header. */
    readonly failed_op?: unknown;
    /** Defensive: set when enrichment fields were not JSON-serializable. */
    readonly serialization_failed?: true;
  };
}

/** Single MCP text content block, as the stdio CallTool handler returns. */
export interface ToolErrorContentBlock {
  readonly type: 'text';
  readonly text: string;
}

function errorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return 'Error';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  // Structural fallback, mirroring the name-based dispatch: duck-typed
  // errors (cross-realm / rehydrated) carry message as a plain field.
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}

function readDiagnostics(err: unknown): readonly unknown[] | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const d = (err as { diagnostics?: unknown }).diagnostics;
  return Array.isArray(d) ? d : undefined;
}

function readStringField(err: unknown, field: string): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const v = (err as Record<string, unknown>)[field];
  return typeof v === 'string' ? v : undefined;
}

function readNumberField(err: unknown, field: string): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const v = (err as Record<string, unknown>)[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readUnknownField(err: unknown, field: string): unknown {
  if (typeof err !== 'object' || err === null) return undefined;
  return (err as Record<string, unknown>)[field];
}

function diagnosticsPayload(diagnostics: readonly unknown[]):
  | {
      readonly diagnostics: readonly unknown[];
      readonly diagnostics_truncated?: number;
    }
  | Record<string, never> {
  const truncated = diagnostics.length - DIAGNOSTICS_CAP;
  return {
    diagnostics: truncated > 0 ? diagnostics.slice(0, DIAGNOSTICS_CAP) : diagnostics,
    ...(truncated > 0 ? { diagnostics_truncated: truncated } : {}),
  };
}

/**
 * Build the machine-readable payload for a thrown tool error. Pure.
 * See the file header for the full field contract.
 */
export function toolErrorPayload(err: unknown): ToolErrorPayload {
  const name = errorName(err);
  const message = errorMessage(err);

  if (name === 'ValidationFailedError') {
    const diagnostics = readDiagnostics(err);
    if (diagnostics !== undefined) {
      return {
        error: {
          name,
          message,
          ...diagnosticsPayload(diagnostics),
        },
      };
    }
  }

  if (name === 'DriftError') {
    const expectedHash = readStringField(err, 'expectedHash');
    const actualHash = readStringField(err, 'actualHash');
    if (expectedHash !== undefined && actualHash !== undefined) {
      return {
        error: { name, message, expected_hash: expectedHash, actual_hash: actualHash },
      };
    }
  }

  if (name === 'BatchOpError') {
    const failedOpIndex = readNumberField(err, 'failedOpIndex');
    const failedOp = readUnknownField(err, 'failedOp');
    if (failedOpIndex !== undefined && failedOp !== undefined) {
      const diagnostics = readDiagnostics(err);
      return {
        error: {
          name,
          message,
          failed_op_index: failedOpIndex,
          failed_op: failedOp,
          ...(diagnostics !== undefined ? diagnosticsPayload(diagnostics) : {}),
        },
      };
    }
  }

  return { error: { name, message } };
}

/**
 * Serialize a thrown tool error into the stdio content array: the legacy
 * human-readable line (byte-identical prefix `Tool '<name>' failed: <message>`)
 * followed by a blank line and the pretty-printed {@link ToolErrorPayload}
 * JSON block, as ONE text content block. Pure; never throws.
 */
export function toolErrorContent(toolName: string, err: unknown): ToolErrorContentBlock[] {
  const payload = toolErrorPayload(err);
  let json: string;
  try {
    json = JSON.stringify(payload, null, 2);
  } catch {
    // Enrichment was not JSON-serializable (e.g. circular diagnostics).
    // Degrade LOUDLY: keep name + message, flag the drop.
    json = JSON.stringify(
      {
        error: {
          name: payload.error.name,
          message: payload.error.message,
          serialization_failed: true,
        },
      },
      null,
      2,
    );
  }
  return [
    {
      type: 'text',
      text: `Tool '${toolName}' failed: ${errorMessage(err)}\n\n${json}`,
    },
  ];
}
