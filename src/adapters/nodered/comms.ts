import WebSocket from 'ws';

import type { Logger } from '../../shared/logger.js';

import type { NodeRedAuth } from './auth.js';

export interface DebugMessage {
  /** Source node id (Node-RED `id`). May be absent for runtime-injected frames. */
  readonly id?: string;
  /** Flow (tab) id this node lives on. */
  readonly z?: string;
  /** Source node `name` (Node-RED label). */
  readonly name?: string;
  /** `msg.topic`. */
  readonly topic?: string;
  /** Stringified payload as Node-RED renders it for the debug pane. */
  readonly msg: string;
  /** `format` hint (e.g. "string", "Object", "number", "array[N]"). */
  readonly format?: string;
  /** Server-side ms-since-epoch. */
  readonly timestamp?: number;
  /** Client-side ISO timestamp set when the frame was buffered. */
  readonly received_at: string;
}

export interface NodeRedCommsClientOptions {
  baseUrl: string;
  auth: NodeRedAuth;
  bufferSize: number;
  logger?: Logger;
  /** Override clock for tests. */
  clock?: () => Date;
  /** Override WebSocket constructor for tests. */
  webSocketImpl?: typeof WebSocket;
  /** Override the reconnect schedule (ms per attempt). */
  reconnectSchedule?: readonly number[];
  /**
   * Hard cap on the open handshake. Without this, a stalled TCP connect
   * leaves the awaiter hanging indefinitely. Defaults to 10 seconds.
   */
  connectTimeoutMs?: number;
}

const DEFAULT_RECONNECT_SCHEDULE: readonly number[] = [1_000, 2_000, 5_000, 15_000, 30_000];
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

interface CommsFrame {
  topic?: string;
  data?: unknown;
}

/**
 * Connects to a Node-RED `/comms` WebSocket and maintains an in-memory ring
 * buffer of `topic === 'debug'` frames. Lazy: nothing happens until `connect()`
 * is called.
 *
 * Auth handshake supports both schemes Node-RED accepts:
 *   1. `Authorization: Bearer <token>` header on the upgrade request (preferred
 *      for newer Node-RED + reverse-proxy / SSO setups).
 *   2. A `{auth: '<token>'}` JSON frame sent immediately after `open`
 *      (preferred for older Node-RED + classic adminAuth).
 *
 * Both are sent unconditionally when a bearer token is available — Node-RED
 * tolerates extras. For `Basic` / username+password auth the password-grant
 * is exchanged for a Bearer token via `NodeRedAuth.getAuthHeader()` first.
 *
 * Reconnect: bounded backoff schedule (1s, 2s, 5s, 15s, 30s). After the
 * schedule exhausts, the client goes silent until `connect()` is called again
 * or `dispose()` is invoked.
 */
export class NodeRedCommsClient {
  private readonly opts: NodeRedCommsClientOptions;
  private readonly clock: () => Date;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly reconnectSchedule: readonly number[];
  private readonly buffer: (DebugMessage | undefined)[];
  private readonly bufferCap: number;
  private writeIndex = 0;
  private droppedCount = 0;
  private lastEventAt: string | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  constructor(opts: NodeRedCommsClientOptions) {
    if (!Number.isInteger(opts.bufferSize) || opts.bufferSize < 1) {
      throw new Error(
        `NodeRedCommsClient: bufferSize must be a positive integer; got ${opts.bufferSize}`,
      );
    }
    this.opts = opts;
    this.clock = opts.clock ?? ((): Date => new Date());
    this.WebSocketCtor = opts.webSocketImpl ?? WebSocket;
    this.reconnectSchedule = opts.reconnectSchedule ?? DEFAULT_RECONNECT_SCHEDULE;
    this.bufferCap = opts.bufferSize;
    this.buffer = new Array(this.bufferCap).fill(undefined) as undefined[];
  }

  /**
   * Open the WebSocket. Idempotent: subsequent calls while already connected /
   * connecting are no-ops. Safe to call after a temporary disconnect to restart
   * the reconnect schedule.
   */
  async connect(): Promise<void> {
    if (this.disposed) {
      throw new Error('NodeRedCommsClient: cannot connect after dispose()');
    }
    if (this.ws !== null) return;
    this.reconnectAttempt = 0;
    await this.openSocket();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws !== null) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate();
      } catch {
        // best-effort
      }
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Returns a snapshot of the ring buffer in chronological order (oldest first).
   * Caller-owned: subsequent buffer mutations do not affect the returned array.
   */
  snapshot(): readonly DebugMessage[] {
    const out: DebugMessage[] = [];
    for (let i = 0; i < this.bufferCap; i++) {
      const slot = this.buffer[(this.writeIndex + i) % this.bufferCap];
      if (slot !== undefined) out.push(slot);
    }
    return out;
  }

  droppedSinceStart(): number {
    return this.droppedCount;
  }

  lastEventTimestamp(): string | null {
    return this.lastEventAt;
  }

  bufferSize(): number {
    return this.bufferCap;
  }

  private async openSocket(): Promise<void> {
    if (this.disposed) return;
    const wsUrl = toWsUrl(this.opts.baseUrl);
    const authHeader: { name: string; value: string } | null = await this.opts.auth
      .getAuthHeader()
      .catch((err: unknown) => {
        this.opts.logger?.warn(
          { err: String(err) },
          'comms: failed to resolve auth header; connecting without auth',
        );
        return null;
      });
    const headers: Record<string, string> = {};
    let bearerForFrame: string | null = null;
    if (authHeader !== null && authHeader !== undefined) {
      headers[authHeader.name] = authHeader.value;
      // Node-RED's older comms protocol expects a frame-based auth. Extract a
      // bare token (strip "Bearer " prefix if present) so we can also send it
      // as the first JSON frame post-open.
      bearerForFrame = authHeader.value.replace(/^Bearer\s+/i, '');
    }

    let socket: WebSocket;
    try {
      socket = new this.WebSocketCtor(wsUrl, { headers });
    } catch (err) {
      this.opts.logger?.warn(
        { url: wsUrl, err: String(err) },
        'comms: failed to construct WebSocket; scheduling reconnect',
      );
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    // Long-lived handlers first so a close that fires before/after open is
    // still observed by the reconnect path.
    socket.on('message', (raw: WebSocket.RawData) => {
      this.handleFrame(raw);
    });
    socket.on('close', () => {
      this.connected = false;
      this.ws = null;
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    });
    socket.on('error', (err) => {
      // 'close' fires after 'error'; just record and let close trigger reconnect.
      this.opts.logger?.debug({ err: String(err) }, 'comms: socket error');
    });

    // Wait for the open handshake so callers' next action (e.g. firing a
    // debug-emitting flow) doesn't race ahead of subscription. If open never
    // arrives, the close handler above will schedule the next reconnect.
    // Hard timeout: if the upstream stalls mid-handshake, terminate the
    // socket so we don't leak it AND the awaiter resolves so the caller
    // (`get_recent_debug_messages`) doesn't hang.
    const connectTimeoutMs = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    await new Promise<void>((resolve) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const cleanup = (): void => {
        socket.off('open', onOpen);
        socket.off('close', onCloseOrError);
        socket.off('error', onCloseOrError);
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      };
      const onOpen = (): void => {
        this.connected = true;
        this.reconnectAttempt = 0;
        if (bearerForFrame !== null) {
          try {
            socket.send(JSON.stringify({ auth: bearerForFrame }));
          } catch (err) {
            this.opts.logger?.warn({ err: String(err) }, 'comms: failed to send auth frame');
          }
        }
        this.opts.logger?.debug({ url: wsUrl }, 'comms: connected');
        cleanup();
        resolve();
      };
      const onCloseOrError = (): void => {
        cleanup();
        resolve();
      };
      socket.once('open', onOpen);
      socket.once('close', onCloseOrError);
      socket.once('error', onCloseOrError);
      timeoutHandle = setTimeout(() => {
        this.opts.logger?.warn(
          { url: wsUrl, timeoutMs: connectTimeoutMs },
          'comms: connect timeout; terminating socket and scheduling reconnect',
        );
        cleanup();
        try {
          socket.terminate();
        } catch {
          // best-effort
        }
        resolve();
      }, connectTimeoutMs);
    });
  }

  private handleFrame(raw: WebSocket.RawData): void {
    const text = rawDataToString(raw);
    if (text === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // ignore malformed frames
    }
    // Node-RED's /comms batches multiple events per WebSocket frame as a JSON
    // array. Single-object frames also occur on older runtimes — handle both.
    const frames: CommsFrame[] = Array.isArray(parsed)
      ? (parsed as CommsFrame[])
      : [parsed as CommsFrame];
    for (const frame of frames) {
      this.handleSingleFrame(frame);
    }
  }

  private handleSingleFrame(frame: CommsFrame): void {
    if (frame.topic !== 'debug' || frame.data === undefined || frame.data === null) return;
    const data = frame.data as Record<string, unknown>;
    const now = this.clock().toISOString();
    const id = data['id'];
    const z = data['z'];
    const name = data['name'];
    const topic = data['topic'];
    const format = data['format'];
    const timestamp = data['timestamp'];
    const debug: DebugMessage = {
      ...(typeof id === 'string' ? { id } : {}),
      ...(typeof z === 'string' ? { z } : {}),
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof topic === 'string' ? { topic } : {}),
      msg: stringifyMsg(data['msg']),
      ...(typeof format === 'string' ? { format } : {}),
      ...(typeof timestamp === 'number' ? { timestamp } : {}),
      received_at: now,
    };
    this.push(debug);
    this.lastEventAt = now;
  }

  private push(msg: DebugMessage): void {
    const slot = this.buffer[this.writeIndex];
    if (slot !== undefined) this.droppedCount += 1;
    this.buffer[this.writeIndex] = msg;
    this.writeIndex = (this.writeIndex + 1) % this.bufferCap;
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectTimer !== null) return;
    if (this.reconnectAttempt >= this.reconnectSchedule.length) {
      this.opts.logger?.warn(
        { attempts: this.reconnectAttempt },
        'comms: reconnect schedule exhausted; staying silent until next connect()',
      );
      return;
    }
    const delay = this.reconnectSchedule[this.reconnectAttempt] ?? 30_000;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket();
    }, delay);
    // Allow the Node.js event loop to exit even if reconnect is pending.
    this.reconnectTimer.unref?.();
  }
}

function toWsUrl(baseUrl: string): string {
  return (
    baseUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      .replace(/\/$/, '') + '/comms'
  );
}

function rawDataToString(raw: WebSocket.RawData): string | null {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Buffer) return raw.toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  if (Array.isArray(raw)) {
    try {
      return Buffer.concat(raw).toString('utf8');
    } catch {
      return null;
    }
  }
  return null;
}

function stringifyMsg(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return String(raw);
  try {
    return JSON.stringify(raw);
  } catch {
    return '[unserializable]';
  }
}
