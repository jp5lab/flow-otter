import { z } from 'zod';

import type { DebugMessage } from '../../../adapters/nodered/comms.js';
import { type Tool } from '../_tool.js';

const InputSchema = z
  .object({
    limit: z.number().int().positive().max(10_000).optional(),
    since_ms: z.number().int().nonnegative().optional(),
    node_id: z.string().min(1).optional(),
    flow_id: z.string().min(1).optional(),
    topic_filter: z.string().min(1).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const DebugMessageSchema = z.object({
  id: z.string().optional(),
  z: z.string().optional(),
  name: z.string().optional(),
  topic: z.string().optional(),
  msg: z.string(),
  format: z.string().optional(),
  timestamp: z.number().optional(),
  received_at: z.string(),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  connected: z.boolean(),
  buffer_size: z.number().int().nonnegative(),
  dropped_count: z.number().int().nonnegative(),
  last_event_at: z.string().nullable(),
  messages: z.array(DebugMessageSchema),
});
type Output = z.infer<typeof OutputSchema>;

export const getRecentDebugMessagesTool: Tool<Input, Output> = {
  name: 'get_recent_debug_messages',
  description:
    "Returns the recent debug messages captured from the active Node-RED target's /comms WebSocket stream (topic `debug` only). Connects lazily on first call. Filterable by node id, flow (tab) id, topic substring, since-ms timestamp, and limit. Buffer is bounded by DEBUG_BUFFER_SIZE (default 500); overflow drops oldest. Returns `connected:false` if no admin-api target is active.",
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 10_000 },
      since_ms: { type: 'integer', minimum: 0 },
      node_id: { type: 'string', minLength: 1 },
      flow_id: { type: 'string', minLength: 1 },
      topic_filter: { type: 'string', minLength: 1 },
    },
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const comms = ctx.container.comms;
    if (comms === undefined) {
      return {
        ok: true,
        connected: false,
        buffer_size: 0,
        dropped_count: 0,
        last_event_at: null,
        messages: [],
      };
    }
    if (!comms.isConnected()) {
      // Lazy connect. Await the WebSocket open promise so the first poll has a
      // chance to see live messages, but don't fail the call if it doesn't open
      // — the buffer may still hold messages from a previous successful session.
      try {
        await comms.connect();
      } catch (err) {
        ctx.logger.warn({ err: String(err) }, 'comms: lazy connect failed');
      }
    }

    const snapshot = comms.snapshot();
    const filtered = applyFilters(snapshot, input);
    const limited =
      input.limit !== undefined && filtered.length > input.limit
        ? filtered.slice(filtered.length - input.limit)
        : filtered;

    return {
      ok: true,
      connected: comms.isConnected(),
      buffer_size: comms.bufferSize(),
      dropped_count: comms.droppedSinceStart(),
      last_event_at: comms.lastEventTimestamp(),
      messages: [...limited],
    };
  },
};

function applyFilters(messages: readonly DebugMessage[], filter: Input): DebugMessage[] {
  return messages.filter((m) => {
    if (filter.node_id !== undefined && m.id !== filter.node_id) return false;
    if (filter.flow_id !== undefined && m.z !== filter.flow_id) return false;
    if (filter.topic_filter !== undefined) {
      const topic = m.topic ?? '';
      if (!topic.includes(filter.topic_filter)) return false;
    }
    if (filter.since_ms !== undefined) {
      const ts = m.timestamp ?? Date.parse(m.received_at);
      if (!Number.isNaN(ts) && ts < filter.since_ms) return false;
    }
    return true;
  });
}
