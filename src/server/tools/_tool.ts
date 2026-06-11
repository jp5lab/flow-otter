import type { z } from 'zod';

import { canonicalHash } from '../../shared/hash.js';
import type { AuditEvent, AuditResult } from '../audit/schema.js';
import type { Container } from '../container.js';
import type { ToolTier } from '../config/tiers.js';
import { buildNudgeContext } from '../nudges/context.js';
import { buildNudgeRegistry, evaluateNudges } from '../nudges/registry.js';

export interface ToolContext extends Container {
  enrichAudit: (patch: Partial<AuditEvent>) => void;
  /**
   * Reference to the live mutable container. Most tools should use the spread
   * properties on `ToolContext` directly. `set_target` uses this to swap
   * target-bound state in place so subsequent tool calls see the new target.
   */
  container: Container;
}

/**
 * MCP-spec tool annotations (Tool Annotations, MCP 2025-03 protocol).
 * Surface to clients (Claude Desktop, Cursor, etc.) so the UI can communicate
 * intent. Annotations are hints — the client may display them but cannot rely
 * on them for enforcement. FlowOtter's actual enforcement comes from
 * tier-gating in `config/tiers.ts`.
 *
 * https://modelcontextprotocol.io/specification/2025-03-26/server/tools#tool-annotations
 */
export interface ToolAnnotations {
  /** Optional human-readable display name shown in client UIs. */
  readonly title?: string;
  /** True if the tool does not modify its environment. */
  readonly readOnlyHint?: boolean;
  /** True if the tool may perform destructive updates (delete/overwrite). */
  readonly destructiveHint?: boolean;
  /** True if calling repeatedly with the same args has no additional effect. */
  readonly idempotentHint?: boolean;
  /** True if the tool interacts with entities outside the local server. */
  readonly openWorldHint?: boolean;
}

/**
 * Default annotations per tier. Tools may override individual fields by
 * supplying their own `annotations` object on the Tool definition.
 *
 * Reasoning:
 * - read / validate: pure observation, no mutation. Idempotent (calling twice
 *   yields the same answer). Open-world only when talking to a live Node-RED
 *   (admin-api) — we conservatively mark openWorld=true since the agent can't
 *   distinguish at registration time.
 * - author / stage: mutates local staging directory but not the live runtime.
 *   Not idempotent (each call adds a node). Not open-world (staging is local).
 * - deploy: mutates live Node-RED runtime. Destructive in that it can roll
 *   nodes forward over previous state. Not idempotent. Open-world.
 * - dangerous: explicit destructive operations (delete-tab, reset-runtime,
 *   replace-flows). Always destructive + open-world.
 */
export function defaultAnnotationsForTier(tier: ToolTier): ToolAnnotations {
  switch (tier) {
    case 'read':
    case 'validate':
      return {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      };
    case 'author':
    case 'stage':
      return {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      };
    case 'deploy':
      return {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      };
    case 'dangerous':
      return {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      };
  }
}

/**
 * Resolve a tool's annotations: merge tier defaults with per-tool overrides.
 * The per-tool field wins for any key it specifies.
 */
export function resolveAnnotations(tier: ToolTier, override?: ToolAnnotations): ToolAnnotations {
  const defaults = defaultAnnotationsForTier(tier);
  if (!override) return defaults;
  return { ...defaults, ...override };
}

/**
 * MCP content blocks a tool's `buildContent` hook may emit. Text blocks are
 * the default; image blocks carry base64 data (e.g. render_flow_png with
 * `return_image: true`).
 */
export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface Tool<TIn = unknown, TOut = unknown> {
  readonly name: string;
  readonly description: string;
  readonly tier: ToolTier;
  readonly inputZod: z.ZodType<TIn>;
  readonly inputJsonSchema: Readonly<Record<string, unknown>>;
  readonly outputZod?: z.ZodType<TOut>;
  readonly handler: (input: TIn, ctx: ToolContext) => Promise<TOut>;
  /**
   * Per-tool override of MCP annotation hints. Any field omitted falls back
   * to `defaultAnnotationsForTier(tier)`. Optional — most tools should rely
   * on the per-tier defaults.
   */
  readonly annotations?: ToolAnnotations;
  /**
   * Optional success-path content builder (REND-5). When present, the stdio
   * transport calls it with the tool's (possibly nudge-enriched) output and
   * the validated input to produce the MCP content array. When absent the
   * transport emits the default single pretty-JSON text block — that default
   * path is pinned byte-identical by regression tests. Error paths never
   * reach this hook.
   */
  readonly buildContent?: (
    output: TOut,
    input: TIn,
  ) => Promise<ToolContentBlock[]> | ToolContentBlock[];
}

export interface InvokableTool {
  readonly name: string;
  readonly description: string;
  readonly tier: ToolTier;
  readonly inputZod: z.ZodType<unknown>;
  readonly inputJsonSchema: Readonly<Record<string, unknown>>;
  /** Resolved annotations (tier defaults merged with per-tool overrides). */
  readonly annotations: ToolAnnotations;
  /** Success-path content builder pass-through; see Tool.buildContent. */
  readonly buildContent?: (
    output: unknown,
    input: unknown,
  ) => Promise<ToolContentBlock[]> | ToolContentBlock[];
  invoke(input: unknown, container: Container): Promise<unknown>;
}

export class ToolBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolBlockedError';
  }
}

/**
 * Validation/lint failure carrying its diagnostics. The stdio transport
 * serializes `name` and `diagnostics` into the structured error payload
 * (src/server/transport/tool-error.ts) — renaming either breaks that
 * contract.
 */
export class ValidationFailedError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: readonly unknown[],
  ) {
    super(message);
    this.name = 'ValidationFailedError';
  }
}

function classifyError(err: unknown): AuditResult {
  if (err === null || err === undefined) return 'error';
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    if (name === 'DriftError') return 'drift_detected';
    if (name === 'ValidationFailedError') return 'validation_failed';
    if (name === 'ToolBlockedError') return 'blocked';
    if (name === 'AuthFailedError') return 'error';
  }
  return 'error';
}

export function makeInvokable<TIn, TOut>(tool: Tool<TIn, TOut>): InvokableTool {
  return {
    name: tool.name,
    description: tool.description,
    tier: tool.tier,
    inputZod: tool.inputZod,
    inputJsonSchema: tool.inputJsonSchema,
    annotations: resolveAnnotations(tool.tier, tool.annotations),
    ...(tool.buildContent !== undefined
      ? {
          buildContent: tool.buildContent as (
            output: unknown,
            input: unknown,
          ) => Promise<ToolContentBlock[]> | ToolContentBlock[],
        }
      : {}),
    invoke: async (rawInput: unknown, container: Container): Promise<unknown> => {
      const startedAt = container.clock();
      const argsHash = canonicalHash(rawInput ?? null);
      const enrichments: Partial<AuditEvent> = {};
      // Snapshot audit-relevant container state at invocation time. If the
      // tool is `set_target` (or anything else that rebinds the live
      // container), the audit event still attributes the call to the env /
      // target / actor that issued it — not to whatever the container
      // happens to point at after the rebind. The audit sink is also
      // snapshotted so the event is written to the env-scoped log file
      // that was active when the call started.
      const snapshot = {
        actor: container.config.ACTOR_NAME,
        environment: container.config.ENVIRONMENT_NAME,
        flowSourceTarget: container.flowSource.describe().target,
        audit: container.audit,
        logger: container.logger,
      };
      const ctx: ToolContext = Object.assign({}, container, {
        enrichAudit: (patch: Partial<AuditEvent>): void => {
          Object.assign(enrichments, patch);
        },
        container,
      });
      let outResult: AuditResult = 'success';
      let errorMessage: string | null = null;
      let output: TOut | undefined;
      let thrown: unknown = null;
      try {
        const validated = tool.inputZod.parse(rawInput);
        output = await tool.handler(validated, ctx);

        // Soft-nudge: append _guidance to object outputs when applicable
        // nudges fire. Defensive — nudge evaluation must not break the
        // tool call, so all failures are caught and logged.
        if (typeof output === 'object' && output !== null && !Array.isArray(output)) {
          try {
            const nudges = buildNudgeRegistry(container);
            const hasApplicable = nudges.some((n) => {
              try {
                return n.applies(tool.name, tool.tier);
              } catch {
                return false;
              }
            });
            if (hasApplicable) {
              const nudgeCtx = await buildNudgeContext(container, tool.name, tool.tier);
              const guidance = evaluateNudges(
                nudges,
                nudgeCtx,
                validated,
                output,
                container.logger,
              );
              if (guidance.length > 0) {
                output = { ...output, _guidance: guidance };
              }
            }
          } catch (nudgeErr) {
            container.logger.warn(
              { err: nudgeErr instanceof Error ? nudgeErr.message : String(nudgeErr) },
              'nudge evaluation failed; tool result returned without guidance',
            );
          }
        }

        return output;
      } catch (err) {
        thrown = err;
        outResult = classifyError(err);
        errorMessage = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const finishedAt = container.clock();
        const durationMs = finishedAt.getTime() - startedAt.getTime();
        const event: AuditEvent = {
          ts: startedAt.toISOString(),
          actor: snapshot.actor,
          tool: tool.name,
          tier: tool.tier,
          args_hash: argsHash,
          result: outResult,
          duration_ms: durationMs,
          flow_source: snapshot.flowSourceTarget,
          environment: snapshot.environment,
          server_version: container.serverVersion,
          ...(errorMessage !== null ? { error: errorMessage } : {}),
          ...enrichments,
        };
        // ensure result hasn't been clobbered by enrichment
        event.result = outResult;
        if (errorMessage !== null) event.error = errorMessage;
        try {
          await snapshot.audit.record(event);
        } catch (auditErr) {
          snapshot.logger.error(
            { auditErr: String(auditErr), tool: tool.name },
            'audit emit failed',
          );
        }
        void thrown;
      }
    },
  };
}
