import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import type {
  DebugMessage,
  NodeRedCommsClient,
} from '../../../../../src/adapters/nodered/comms.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { Container } from '../../../../../src/server/container.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { getRecentDebugMessagesTool } from '../../../../../src/server/tools/read/get-recent-debug-messages.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';
import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';

class FakeCommsClient {
  private messages: DebugMessage[];
  private connectImpl: () => Promise<void>;
  private connected = false;
  public connectCalls = 0;

  constructor(messages: DebugMessage[], connectImpl?: () => Promise<void>) {
    this.messages = messages;
    this.connectImpl = connectImpl ?? ((): Promise<void> => Promise.resolve());
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    await this.connectImpl();
    this.connected = true;
  }
  dispose(): void {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  snapshot(): readonly DebugMessage[] {
    return [...this.messages];
  }
  droppedSinceStart(): number {
    return 0;
  }
  lastEventTimestamp(): string | null {
    return this.messages.at(-1)?.received_at ?? null;
  }
  bufferSize(): number {
    return this.messages.length;
  }
}

function msg(partial: Partial<DebugMessage> & { received_at: string; msg: string }): DebugMessage {
  return partial;
}

let cleanup: () => Promise<void>;
let ctx: ToolContext;
let fakeComms: FakeCommsClient;

async function buildCtx(
  messages: DebugMessage[],
  connectImpl?: () => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'grdm-'));
  const flowsPath = path.join(root, 'flows.json');
  await import('node:fs/promises').then((fsp) =>
    fsp.writeFile(flowsPath, JSON.stringify([]), 'utf8'),
  );
  const merged: Record<string, string> = {
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
  };
  const config = loadConfig(merged);
  const logger = createLogger({ level: 'silent' });
  fakeComms = new FakeCommsClient(messages, connectImpl);

  const containerFields: Container = {
    config,
    flowSource: new FileFlowSource({ path: flowsPath }),
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging: new StagedStore({ dir: config.STAGING_DIR }),
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: () => new Date('2026-05-10T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
    comms: fakeComms as unknown as NodeRedCommsClient,
  };
  ctx = {
    ...containerFields,
    enrichAudit: () => undefined,
    container: containerFields,
  };
  cleanup = async (): Promise<void> => {
    await rm(root, { recursive: true, force: true });
  };
}

const M1 = msg({
  id: 'n1',
  z: 't1',
  topic: 'sensor/temp',
  msg: '22.5',
  timestamp: 1_000,
  received_at: '2026-05-10T00:00:01.000Z',
});
const M2 = msg({
  id: 'n2',
  z: 't1',
  topic: 'sensor/humid',
  msg: '40',
  timestamp: 2_000,
  received_at: '2026-05-10T00:00:02.000Z',
});
const M3 = msg({
  id: 'n3',
  z: 't2',
  topic: 'alarm/level',
  msg: 'high',
  timestamp: 3_000,
  received_at: '2026-05-10T00:00:03.000Z',
});

afterEach(async () => {
  if (cleanup) await cleanup();
  vi.useRealTimers();
});

describe('get_recent_debug_messages tool', () => {
  beforeEach(async () => {
    await buildCtx([M1, M2, M3]);
  });

  it('returns all messages with no filter', async () => {
    const out = await getRecentDebugMessagesTool.handler({}, ctx);
    expect(out.ok).toBe(true);
    expect(out.messages).toHaveLength(3);
    expect(out.connected).toBe(true);
    expect(out.dropped_count).toBe(0);
  });

  it('triggers lazy connect on first call', async () => {
    await getRecentDebugMessagesTool.handler({}, ctx);
    expect(fakeComms.connectCalls).toBe(1);
    await getRecentDebugMessagesTool.handler({}, ctx);
    // Already connected → no new connect.
    expect(fakeComms.connectCalls).toBe(1);
  });

  it('filters by node_id', async () => {
    const out = await getRecentDebugMessagesTool.handler({ node_id: 'n2' }, ctx);
    expect(out.messages.map((m) => m.id)).toEqual(['n2']);
  });

  it('filters by flow_id', async () => {
    const out = await getRecentDebugMessagesTool.handler({ flow_id: 't1' }, ctx);
    expect(out.messages.map((m) => m.id)).toEqual(['n1', 'n2']);
  });

  it('filters by topic substring', async () => {
    const out = await getRecentDebugMessagesTool.handler({ topic_filter: 'sensor' }, ctx);
    expect(out.messages.map((m) => m.id)).toEqual(['n1', 'n2']);
  });

  it('filters by since_ms (uses timestamp field)', async () => {
    const out = await getRecentDebugMessagesTool.handler({ since_ms: 2_000 }, ctx);
    expect(out.messages.map((m) => m.id)).toEqual(['n2', 'n3']);
  });

  it('respects limit, keeping the most recent', async () => {
    const out = await getRecentDebugMessagesTool.handler({ limit: 2 }, ctx);
    expect(out.messages.map((m) => m.id)).toEqual(['n2', 'n3']);
  });

  it('combines filters (flow_id + limit)', async () => {
    const out = await getRecentDebugMessagesTool.handler({ flow_id: 't1', limit: 1 }, ctx);
    expect(out.messages.map((m) => m.id)).toEqual(['n2']);
  });

  it('returns empty list with connected=false when no comms client (file source)', async () => {
    // Strip comms off the container to simulate no admin-api target.
    delete ctx.container.comms;
    const out = await getRecentDebugMessagesTool.handler({}, ctx);
    expect(out.ok).toBe(true);
    expect(out.connected).toBe(false);
    expect(out.messages).toEqual([]);
  });

  it('does not throw if lazy connect fails — returns whatever is buffered', async () => {
    if (cleanup) await cleanup();
    await buildCtx([M1, M2], () => Promise.reject(new Error('connect kaboom')));
    const out = await getRecentDebugMessagesTool.handler({}, ctx);
    expect(out.messages).toHaveLength(2);
    expect(out.connected).toBe(false); // fake never flips to true on failed connect path
  });
});
