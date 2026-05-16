import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BearerAuth, NoAuth } from '../../../../src/adapters/nodered/auth.js';
import { NodeRedCommsClient } from '../../../../src/adapters/nodered/comms.js';

class FakeWebSocket extends EventEmitter {
  static instances: FakeWebSocket[] = [];
  static autoOpen = true;
  url: string;
  options: { headers?: Record<string, string> };
  sent: string[] = [];
  terminated = false;
  closed = false;

  constructor(url: string, options: { headers?: Record<string, string> } = {}) {
    super();
    this.url = url;
    this.options = options;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoOpen) {
      // Mimic the real WS upgrade — 'open' fires on next microtask, after
      // the constructor returns and listeners have been attached.
      queueMicrotask(() => this.emit('open'));
    }
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  terminate(): void {
    this.terminated = true;
    this.closed = true;
  }

  close(): void {
    this.closed = true;
  }
}

function freshFakeCtor(): typeof FakeWebSocket {
  FakeWebSocket.instances = [];
  return FakeWebSocket;
}

describe('NodeRedCommsClient', () => {
  let clockNow: number;
  let timestamps: string[];

  beforeEach(() => {
    clockNow = 0;
    timestamps = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mkClient(
    opts: {
      bufferSize?: number;
      auth?: NoAuth | BearerAuth;
      schedule?: readonly number[];
    } = {},
  ): { client: NodeRedCommsClient; Ctor: typeof FakeWebSocket } {
    const Ctor = freshFakeCtor();
    const client = new NodeRedCommsClient({
      baseUrl: 'http://localhost:1880',
      auth: opts.auth ?? new NoAuth(),
      bufferSize: opts.bufferSize ?? 5,
      webSocketImpl: Ctor as unknown as never,
      clock: () => {
        const iso = new Date(clockNow).toISOString();
        timestamps.push(iso);
        return new Date(clockNow);
      },
      reconnectSchedule: opts.schedule ?? [1, 2, 5],
    });
    return { client, Ctor };
  }

  it('rejects non-positive bufferSize at construction', () => {
    expect(
      () =>
        new NodeRedCommsClient({
          baseUrl: 'http://localhost:1880',
          auth: new NoAuth(),
          bufferSize: 0,
        }),
    ).toThrow(/bufferSize/);
  });

  it('upgrades http to ws and https to wss', async () => {
    const Ctor = freshFakeCtor();
    const c1 = new NodeRedCommsClient({
      baseUrl: 'http://nr.example:1880',
      auth: new NoAuth(),
      bufferSize: 4,
      webSocketImpl: Ctor as unknown as never,
    });
    await c1.connect();
    expect(Ctor.instances[0]?.url).toBe('ws://nr.example:1880/comms');
    c1.dispose();

    const Ctor2 = freshFakeCtor();
    const c2 = new NodeRedCommsClient({
      baseUrl: 'https://nr.example/',
      auth: new NoAuth(),
      bufferSize: 4,
      webSocketImpl: Ctor2 as unknown as never,
    });
    await c2.connect();
    expect(Ctor2.instances[0]?.url).toBe('wss://nr.example/comms');
    c2.dispose();
  });

  it('sends Authorization header and an auth frame for BearerAuth', async () => {
    const { client, Ctor } = mkClient({ auth: new BearerAuth('tok123') });
    await client.connect();
    const ws = Ctor.instances[0]!;
    expect(ws.options.headers?.['Authorization']).toBe('Bearer tok123');
    ws.emit('open');
    expect(ws.sent).toEqual([JSON.stringify({ auth: 'tok123' })]);
    client.dispose();
  });

  it('buffers debug frames in chronological order; snapshot() returns oldest-first', async () => {
    const { client, Ctor } = mkClient({ bufferSize: 5 });
    await client.connect();
    const ws = Ctor.instances[0]!;
    ws.emit('open');

    clockNow = 1000;
    ws.emit(
      'message',
      Buffer.from(
        JSON.stringify([{ topic: 'debug', data: { id: 'n1', z: 't1', msg: 'one', topic: 'foo' } }]),
      ),
    );
    clockNow = 2000;
    ws.emit(
      'message',
      Buffer.from(
        JSON.stringify([{ topic: 'debug', data: { id: 'n2', z: 't1', msg: { hello: 'world' } } }]),
      ),
    );

    const snap = client.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0]?.id).toBe('n1');
    expect(snap[0]?.msg).toBe('one');
    expect(snap[0]?.topic).toBe('foo');
    expect(snap[1]?.id).toBe('n2');
    expect(snap[1]?.msg).toBe(JSON.stringify({ hello: 'world' }));
    expect(client.isConnected()).toBe(true);
    expect(client.lastEventTimestamp()).toBe(new Date(2000).toISOString());
    client.dispose();
  });

  it('drops oldest when the ring buffer overflows; reports dropped_count', async () => {
    const { client, Ctor } = mkClient({ bufferSize: 3 });
    await client.connect();
    const ws = Ctor.instances[0]!;
    ws.emit('open');

    for (let i = 0; i < 5; i++) {
      clockNow = (i + 1) * 1000;
      ws.emit(
        'message',
        Buffer.from(JSON.stringify([{ topic: 'debug', data: { id: `n${i}`, msg: String(i) } }])),
      );
    }

    const snap = client.snapshot();
    expect(snap.map((m) => m.id)).toEqual(['n2', 'n3', 'n4']);
    expect(client.droppedSinceStart()).toBe(2);
    client.dispose();
  });

  it('ignores non-debug topics (auth, status/*, notification/*)', async () => {
    const { client, Ctor } = mkClient();
    await client.connect();
    const ws = Ctor.instances[0]!;
    ws.emit('open');

    ws.emit('message', Buffer.from(JSON.stringify([{ topic: 'auth', data: 'ok' }])));
    ws.emit(
      'message',
      Buffer.from(JSON.stringify([{ topic: 'status/abc', data: { fill: 'green' } }])),
    );
    ws.emit(
      'message',
      Buffer.from(
        JSON.stringify([{ topic: 'notification/runtime-state', data: { state: 'start' } }]),
      ),
    );

    expect(client.snapshot()).toEqual([]);
    client.dispose();
  });

  it('handles multi-event batched frames (Node-RED array shape)', async () => {
    const { client, Ctor } = mkClient({ bufferSize: 10 });
    await client.connect();
    const ws = Ctor.instances[0]!;
    ws.emit('open');

    clockNow = 5000;
    ws.emit(
      'message',
      Buffer.from(
        JSON.stringify([
          { topic: 'notification/runtime-state', data: { state: 'start' } },
          { topic: 'debug', data: { id: 'd1', z: 'tabA', msg: 'first' } },
          { topic: 'auth', data: 'ok' },
          { topic: 'debug', data: { id: 'd2', z: 'tabA', msg: 'second' } },
        ]),
      ),
    );

    expect(client.snapshot().map((m) => m.id)).toEqual(['d1', 'd2']);
    client.dispose();
  });

  it('tolerates malformed frames without crashing', async () => {
    const { client, Ctor } = mkClient();
    await client.connect();
    const ws = Ctor.instances[0]!;
    ws.emit('open');

    ws.emit('message', Buffer.from('not json{'));
    ws.emit('message', Buffer.from(JSON.stringify([{ topic: 'debug' }]))); // missing data
    ws.emit('message', Buffer.from(JSON.stringify([{ topic: 'debug', data: null }])));

    expect(client.snapshot()).toEqual([]);
    client.dispose();
  });

  it('dispose() is idempotent and tears down listeners + socket', async () => {
    const { client, Ctor } = mkClient();
    await client.connect();
    const ws = Ctor.instances[0]!;
    client.dispose();
    expect(ws.terminated).toBe(true);
    expect(client.isConnected()).toBe(false);
    // Second dispose is a no-op.
    expect(() => client.dispose()).not.toThrow();
  });

  it('schedules reconnect on close until the schedule is exhausted', async () => {
    // Disable auto-open: every connect attempt fails before 'open', so the
    // reconnect counter genuinely accumulates and the schedule can exhaust.
    FakeWebSocket.autoOpen = false;
    try {
      const { client, Ctor } = mkClient({ schedule: [10, 20] });
      const connectPromise = client.connect();
      // Yield to the auth-header microtask so the socket gets constructed.
      await Promise.resolve();
      await Promise.resolve();
      expect(Ctor.instances).toHaveLength(1);
      Ctor.instances[0]!.emit('close');
      await connectPromise;

      // Wait through the first reconnect delay.
      await new Promise((r) => setTimeout(r, 25));
      expect(Ctor.instances).toHaveLength(2);
      Ctor.instances[1]!.emit('close');

      await new Promise((r) => setTimeout(r, 35));
      expect(Ctor.instances).toHaveLength(3);
      Ctor.instances[2]!.emit('close');

      // Schedule exhausted; no further reconnects.
      await new Promise((r) => setTimeout(r, 50));
      expect(Ctor.instances).toHaveLength(3);

      client.dispose();
    } finally {
      FakeWebSocket.autoOpen = true;
    }
  });

  it('connect() after dispose() throws', async () => {
    const { client } = mkClient();
    client.dispose();
    await expect(client.connect()).rejects.toThrow(/after dispose/);
  });

  it('connect() is idempotent while already constructed', async () => {
    const { client, Ctor } = mkClient();
    await client.connect();
    await client.connect();
    expect(Ctor.instances).toHaveLength(1);
    client.dispose();
  });
});
