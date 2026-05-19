/**
 * MCP elicitation helper. Wraps the SDK's elicitInput so tool handlers can
 * request structured user input (via JSON-Schema forms) without dealing
 * with raw protocol details.
 *
 * Elicitation shipped in MCP spec 2025-06-18 and is supported in Claude
 * Code v2.1.76+ (March 2026). Clients that don't advertise the capability
 * get a synthetic `unsupported` outcome — callers fall back to whatever
 * default the tool implements.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface ElicitFieldString {
  readonly type: 'string';
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly default?: string;
}

export interface ElicitFieldNumber {
  readonly type: 'number';
  readonly description?: string;
  readonly default?: number;
}

export interface ElicitFieldBoolean {
  readonly type: 'boolean';
  readonly description?: string;
  readonly default?: boolean;
}

export type ElicitField = ElicitFieldString | ElicitFieldNumber | ElicitFieldBoolean;

export interface ElicitRequest {
  readonly message: string;
  readonly fields: Readonly<Record<string, ElicitField>>;
  readonly required?: readonly string[];
}

export type ElicitOutcome =
  | { readonly action: 'accept'; readonly content: Readonly<Record<string, unknown>> }
  | { readonly action: 'decline' }
  | { readonly action: 'cancel' }
  | { readonly action: 'unsupported' };

/**
 * Send an elicit request to the client. Returns a synthetic `unsupported`
 * outcome when the client doesn't advertise elicitation, so callers can
 * gracefully fall back.
 *
 * Errors during the request (timeout, transport failure, etc.) are
 * surfaced as `cancel` so callers don't have to differentiate between
 * "user declined" and "transport failed" — both mean "don't proceed."
 */
export async function elicit(
  server: Server | undefined,
  request: ElicitRequest,
): Promise<ElicitOutcome> {
  if (server === undefined) return { action: 'unsupported' };
  const capabilities = server.getClientCapabilities();
  if (capabilities?.elicitation === undefined) return { action: 'unsupported' };

  // Build the JSON-Schema "object" form required by the spec. Fields with
  // an `enum` become string-with-enum constraints; the SDK validator will
  // reject unrelated input.
  const properties: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(request.fields)) {
    if (field.type === 'string') {
      const prop: Record<string, unknown> = { type: 'string' };
      if (field.description !== undefined) prop['description'] = field.description;
      if (field.enum !== undefined && field.enum.length > 0) prop['enum'] = [...field.enum];
      if (field.default !== undefined) prop['default'] = field.default;
      properties[name] = prop;
    } else if (field.type === 'number') {
      const prop: Record<string, unknown> = { type: 'number' };
      if (field.description !== undefined) prop['description'] = field.description;
      if (field.default !== undefined) prop['default'] = field.default;
      properties[name] = prop;
    } else {
      const prop: Record<string, unknown> = { type: 'boolean' };
      if (field.description !== undefined) prop['description'] = field.description;
      if (field.default !== undefined) prop['default'] = field.default;
      properties[name] = prop;
    }
  }
  const schema = {
    type: 'object' as const,
    properties,
    ...(request.required !== undefined && request.required.length > 0
      ? { required: [...request.required] }
      : {}),
  };

  try {
    // SDK's elicitInput accepts a union of Form/URL params; cast via unknown
    // is the cleanest way to satisfy the form-shape without re-declaring
    // every nested schema type the SDK keeps internal.
    const result = await server.elicitInput({
      message: request.message,
      requestedSchema: schema,
    } as unknown as Parameters<Server['elicitInput']>[0]);
    if (result.action === 'accept') {
      return { action: 'accept', content: result.content ?? {} };
    }
    if (result.action === 'decline') return { action: 'decline' };
    return { action: 'cancel' };
  } catch {
    return { action: 'cancel' };
  }
}
