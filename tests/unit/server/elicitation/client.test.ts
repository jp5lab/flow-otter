import { describe, expect, it, vi } from 'vitest';

import { elicit } from '../../../../src/server/elicitation/client.js';

interface FakeServer {
  getClientCapabilities: () => { elicitation?: unknown } | undefined;
  elicitInput: (params: unknown) => Promise<unknown>;
}

function fakeServer(overrides: Partial<FakeServer> = {}): FakeServer {
  return {
    getClientCapabilities: () => ({ elicitation: {} }),
    elicitInput: () => Promise.resolve({ action: 'accept', content: {} }),
    ...overrides,
  };
}

describe('elicit helper', () => {
  it('returns unsupported when server is undefined', async () => {
    const out = await elicit(undefined, {
      message: 'hi',
      fields: { x: { type: 'string' } },
    });
    expect(out.action).toBe('unsupported');
  });

  it('returns unsupported when client did not advertise elicitation', async () => {
    const srv = fakeServer({ getClientCapabilities: () => ({}) });
    const out = await elicit(srv as never, {
      message: 'hi',
      fields: { x: { type: 'string' } },
    });
    expect(out.action).toBe('unsupported');
  });

  it('builds a JSON-Schema "object" form from the request', async () => {
    const captured = vi.fn();
    const srv = fakeServer({
      elicitInput: (params: unknown) => {
        captured(params);
        return Promise.resolve({ action: 'accept', content: { confirm: true } });
      },
    });
    await elicit(srv as never, {
      message: 'Deploy?',
      fields: {
        confirm: { type: 'boolean', default: false, description: 'Proceed?' },
        env: { type: 'string', enum: ['dev', 'prod'] },
      },
      required: ['confirm'],
    });
    expect(captured).toHaveBeenCalledOnce();
    const arg = captured.mock.calls[0]![0] as {
      message: string;
      requestedSchema: { properties: Record<string, unknown>; required?: string[] };
    };
    expect(arg.message).toBe('Deploy?');
    expect(arg.requestedSchema.properties['confirm']).toMatchObject({
      type: 'boolean',
      default: false,
      description: 'Proceed?',
    });
    expect(arg.requestedSchema.properties['env']).toMatchObject({
      type: 'string',
      enum: ['dev', 'prod'],
    });
    expect(arg.requestedSchema.required).toEqual(['confirm']);
  });

  it('returns accept with content when user accepts', async () => {
    const srv = fakeServer({
      elicitInput: () => Promise.resolve({ action: 'accept', content: { x: 'y' } }),
    });
    const out = await elicit(srv as never, {
      message: '?',
      fields: { x: { type: 'string' } },
    });
    expect(out).toEqual({ action: 'accept', content: { x: 'y' } });
  });

  it('returns decline when user declines', async () => {
    const srv = fakeServer({ elicitInput: () => Promise.resolve({ action: 'decline' }) });
    const out = await elicit(srv as never, {
      message: '?',
      fields: { x: { type: 'string' } },
    });
    expect(out.action).toBe('decline');
  });

  it('returns cancel on transport error', async () => {
    const srv = fakeServer({ elicitInput: () => Promise.reject(new Error('lost connection')) });
    const out = await elicit(srv as never, {
      message: '?',
      fields: { x: { type: 'string' } },
    });
    expect(out.action).toBe('cancel');
  });
});
