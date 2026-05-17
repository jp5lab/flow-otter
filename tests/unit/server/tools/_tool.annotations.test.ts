import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  defaultAnnotationsForTier,
  makeInvokable,
  resolveAnnotations,
  type Tool,
} from '../../../../src/server/tools/_tool.js';

describe('defaultAnnotationsForTier', () => {
  it('read tier is readOnly + idempotent + openWorld', () => {
    expect(defaultAnnotationsForTier('read')).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('validate tier matches read defaults', () => {
    expect(defaultAnnotationsForTier('validate')).toEqual(defaultAnnotationsForTier('read'));
  });

  it('author + stage are non-readOnly, non-destructive, non-idempotent, local-world', () => {
    const author = defaultAnnotationsForTier('author');
    expect(author).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(defaultAnnotationsForTier('stage')).toEqual(author);
  });

  it('deploy is destructive + open-world', () => {
    expect(defaultAnnotationsForTier('deploy')).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('dangerous is destructive + open-world', () => {
    expect(defaultAnnotationsForTier('dangerous')).toEqual(defaultAnnotationsForTier('deploy'));
  });
});

describe('resolveAnnotations', () => {
  it('returns tier defaults when no override supplied', () => {
    expect(resolveAnnotations('read')).toEqual(defaultAnnotationsForTier('read'));
  });

  it('per-tool override wins per-field', () => {
    const merged = resolveAnnotations('author', { title: 'Custom Author', destructiveHint: true });
    expect(merged.title).toBe('Custom Author');
    expect(merged.destructiveHint).toBe(true);
    expect(merged.readOnlyHint).toBe(false); // tier default carried
  });
});

describe('makeInvokable annotations', () => {
  it('attaches resolved annotations to InvokableTool', () => {
    const tool: Tool<unknown, unknown> = {
      name: 'demo',
      description: 'demo',
      tier: 'read',
      inputZod: z.object({}).strict(),
      inputJsonSchema: { type: 'object', additionalProperties: false, properties: {} },
      handler: () => Promise.resolve({}),
    };
    const invokable = makeInvokable(tool);
    expect(invokable.annotations.readOnlyHint).toBe(true);
    expect(invokable.annotations.openWorldHint).toBe(true);
  });

  it('honours per-tool override', () => {
    const tool: Tool<unknown, unknown> = {
      name: 'demo-override',
      description: 'demo',
      tier: 'deploy',
      annotations: { idempotentHint: true, title: 'Demo Deploy' },
      inputZod: z.object({}).strict(),
      inputJsonSchema: { type: 'object', additionalProperties: false, properties: {} },
      handler: () => Promise.resolve({}),
    };
    const invokable = makeInvokable(tool);
    expect(invokable.annotations.idempotentHint).toBe(true);
    expect(invokable.annotations.destructiveHint).toBe(true); // tier default
    expect(invokable.annotations.title).toBe('Demo Deploy');
  });
});

describe('makeInvokable audit snapshotting', () => {
  it('attributes the audit event to the actor/environment/flow_source at invocation start, even if container is rebound mid-call', async () => {
    const records: Array<Record<string, unknown>> = [];
    const auditA = { record: (e: Record<string, unknown>) => Promise.resolve(records.push(e)) };
    const auditB = {
      record: (e: Record<string, unknown>) => Promise.resolve(records.push({ wrong: true, ...e })),
    };
    const flowSourceA = {
      describe: () => ({ kind: 'adminapi', target: 'http://A:1880' }),
      load: () => Promise.resolve({ flows: [], rev: null }),
      save: () => Promise.resolve({ rev: 'r1' }),
      fingerprint: () => Promise.resolve({ sha256: '', rev: null }),
      inspectWarnings: () => Promise.resolve([]),
    };
    const flowSourceB = {
      ...flowSourceA,
      describe: () => ({ kind: 'adminapi', target: 'http://B:1880' }),
    };
    const container: Record<string, unknown> = {
      config: { ACTOR_NAME: 'actor-A', ENVIRONMENT_NAME: 'env-A' },
      flowSource: flowSourceA,
      audit: auditA,
      logger: { error: () => undefined },
      clock: () => new Date('2026-05-16T00:00:00.000Z'),
      serverVersion: 'test',
    };
    const tool = {
      name: 'rebind-tool',
      description: '',
      tier: 'read' as const,
      inputZod: z.object({}).strict(),
      inputJsonSchema: { type: 'object', additionalProperties: false, properties: {} },
      handler: (_in: unknown, _ctx: unknown) => {
        // Rebind mid-call — emulate what set_target does.
        container['config'] = { ACTOR_NAME: 'actor-B', ENVIRONMENT_NAME: 'env-B' };
        container['flowSource'] = flowSourceB;
        container['audit'] = auditB;
        return Promise.resolve({});
      },
    };
    const invokable = makeInvokable(tool);
    await invokable.invoke({}, container as never);
    expect(records).toHaveLength(1);
    const event = records[0]!;
    expect(event['actor']).toBe('actor-A');
    expect(event['environment']).toBe('env-A');
    expect(event['flow_source']).toBe('http://A:1880');
    expect(event['wrong']).toBeUndefined();
  });
});

describe('per-tool annotation overrides for read-tier tools with side effects', () => {
  it('set_target and export_snapshot mark readOnlyHint: false', async () => {
    const { setTargetTool } = await import('../../../../src/server/tools/read/set-target.js');
    const { exportSnapshotTool } =
      await import('../../../../src/server/tools/read/export-snapshot.js');
    const setTargetInvokable = makeInvokable(setTargetTool);
    const exportSnapshotInvokable = makeInvokable(exportSnapshotTool);
    expect(setTargetInvokable.annotations.readOnlyHint).toBe(false);
    expect(setTargetInvokable.annotations.idempotentHint).toBe(false);
    expect(exportSnapshotInvokable.annotations.readOnlyHint).toBe(false);
    expect(exportSnapshotInvokable.annotations.idempotentHint).toBe(false);
  });
});
