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
