import { describe, expect, it, vi } from 'vitest';

import { NoAuth } from '../../../../src/adapters/nodered/auth.js';
import { NodeRedClient } from '../../../../src/adapters/nodered/client.js';
import {
  AuthFailedError,
  FeatureDisabledError,
  NodeRedDownError,
  RevMismatchError,
} from '../../../../src/adapters/nodered/errors.js';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('NodeRedClient.getFlows', () => {
  it('parses v2 response shape {flows, rev}', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ flows: [{ id: 't', type: 'tab', label: 'T' }], rev: 'r1' }),
      );
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    const out = await client.getFlows();
    expect(out.rev).toBe('r1');
    expect(out.flows[0]?.type).toBe('tab');
  });

  it('rejects v1-shape (bare array) responses — pre-0.15 Node-RED is unsupported', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: 't', type: 'tab', label: 'T' }]));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await expect(client.getFlows()).rejects.toThrow(/v2 \{flows,rev\}/);
  });

  it('throws NodeRedDownError when fetch keeps failing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect refused'));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 1,
    });
    await expect(client.getFlows()).rejects.toBeInstanceOf(NodeRedDownError);
  });
});

describe('NodeRedClient.getNodeTypes', () => {
  it('returns body of GET /nodes', async () => {
    const body = [{ id: 'node-red/inject', name: 'inject', enabled: true }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    const result = await client.getNodeTypes();
    expect(result).toEqual(body);
    const url = (fetchImpl.mock.calls[0] ?? [])[0] as string;
    expect(url).toContain('/nodes');
  });
});

describe('NodeRedClient.postFlows', () => {
  it('throws RevMismatchError on 409 with actual Node-RED body shape', async () => {
    // Node-RED runtime returns {code:"version_mismatch",message:""} on 409 — no rev field.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'version_mismatch', message: '' }), { status: 409 }),
      );
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await expect(
      client.postFlows([] as never, { rev: 'expected', deployMode: 'nodes' }),
    ).rejects.toBeInstanceOf(RevMismatchError);
  });

  it('sends Node-RED-Deployment-Type header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ rev: 'new' }));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await client.postFlows([] as never, { deployMode: 'flows' });
    const callArgs = (fetchImpl.mock.calls[0] ?? []) as [string, RequestInit];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['Node-RED-Deployment-Type']).toBe('flows');
  });

  it('forwards credentials in POST body when supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ rev: 'new' }));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    const credentials = {
      'mqtt-broker-1': { user: 'admin', password: 'secret' },
    };
    await client.postFlows([] as never, { deployMode: 'nodes', credentials });
    const callArgs = (fetchImpl.mock.calls[0] ?? []) as [string, RequestInit];
    const body = JSON.parse(callArgs[1]?.body as string) as {
      flows: unknown;
      credentials?: unknown;
    };
    expect(body.credentials).toEqual(credentials);
  });

  it('omits credentials key when not supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ rev: 'new' }));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await client.postFlows([] as never, { deployMode: 'nodes' });
    const callArgs = (fetchImpl.mock.calls[0] ?? []) as [string, RequestInit];
    const body = JSON.parse(callArgs[1]?.body as string) as Record<string, unknown>;
    expect('credentials' in body).toBe(false);
  });
});

describe('NodeRedClient 401 vs 403 disambiguation', () => {
  it('throws AuthFailedError on 401 after one auth-reissue retry', async () => {
    // Both attempts return 401 — invalidate fires, retry happens, still 401, throw.
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await expect(client.getFlows()).rejects.toBeInstanceOf(AuthFailedError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // original + reissue
  });

  it('recovers on 401 → invalidate → retry succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ flows: [], rev: 'r1' }));
    const auth = new NoAuth();
    const invalidateSpy = vi.spyOn(auth, 'invalidate');
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth,
      fetchImpl: fetchImpl,
      retries: 0,
    });
    const out = await client.getFlows();
    expect(out.rev).toBe('r1');
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws FeatureDisabledError on 403 with {code:"<x>.disabled"}', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'diagnostics.disabled' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await expect(client.getDiagnostics()).rejects.toBeInstanceOf(FeatureDisabledError);
  });

  it('throws AuthFailedError on 403 without a *.disabled code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await expect(client.getFlows()).rejects.toBeInstanceOf(AuthFailedError);
  });

  it('throws AuthFailedError on 403 with non-JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await expect(client.getFlows()).rejects.toBeInstanceOf(AuthFailedError);
  });
});

describe('NodeRedClient User-Agent', () => {
  it('sends caller-supplied User-Agent on every request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ flows: [], rev: 'r1' }));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
      userAgent: 'FlowOtter/9.9.9-test',
    });
    await client.getFlows();
    const init = (fetchImpl.mock.calls[0] ?? [])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('FlowOtter/9.9.9-test');
  });

  it('falls back to FlowOtter/unknown when no User-Agent supplied (callers should pass version)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ flows: [], rev: 'r1' }));
    const client = new NodeRedClient({
      baseUrl: 'http://localhost:1880',
      auth: new NoAuth(),
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await client.getFlows();
    const init = (fetchImpl.mock.calls[0] ?? [])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('FlowOtter/unknown');
  });
});
