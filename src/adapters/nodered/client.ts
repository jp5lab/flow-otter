import { type FlowsJson, FlowsJsonSchema } from '../../shared/flows-json.js';
import type { Logger } from '../../shared/logger.js';
import type { Credentials, DeployMode } from '../../shared/flow-source.js';

import { DEFAULT_DEPLOY_MODE, DEPLOY_TYPE_HEADER } from './deploy.js';
import {
  AuthFailedError,
  FeatureDisabledError,
  NodeRedDownError,
  NodeRedHttpError,
  RevMismatchError,
} from './errors.js';
import type { NodeRedAuth } from './auth.js';

export interface NodeRedClientOptions {
  baseUrl: string;
  auth: NodeRedAuth;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  /** Number of retries on 5xx + connection errors. Default 2. */
  retries?: number;
  /** User-Agent string sent on every request. Default `FlowOtter/<version>`. */
  userAgent?: string;
}

const DEFAULT_USER_AGENT = 'FlowOtter/unknown';

interface FlowsResponse {
  flows: FlowsJson;
  rev: string | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

export class NodeRedClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(private readonly opts: NodeRedClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = opts.retries ?? DEFAULT_RETRIES;
  }

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  async getFlows(): Promise<FlowsResponse> {
    const res = await this.request('GET', '/flows', undefined, {
      Accept: 'application/json',
      'Node-RED-API-Version': 'v2',
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new NodeRedHttpError(res.status, text, `GET /flows: invalid JSON: ${String(err)}`);
    }
    return parseFlowsResponse(parsed, res);
  }

  async postFlows(
    flows: FlowsJson,
    opts: { rev?: string | null; deployMode?: DeployMode; credentials?: Credentials } = {},
  ): Promise<{ rev: string }> {
    const body = JSON.stringify({
      flows,
      ...(opts.rev !== undefined && opts.rev !== null ? { rev: opts.rev } : {}),
      ...(opts.credentials !== undefined ? { credentials: opts.credentials } : {}),
    });
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'Node-RED-API-Version': 'v2',
      [DEPLOY_TYPE_HEADER]: opts.deployMode ?? DEFAULT_DEPLOY_MODE,
    };
    const res = await this.request('POST', '/flows', body, headers);
    if (res.status === 409) {
      // Node-RED 409 body is {code:"version_mismatch",message:""} — actualRev is
      // not returned. Callers needing the live rev should re-issue GET /flows.
      throw new RevMismatchError(
        opts.rev ?? undefined,
        `POST /flows rejected with 409 rev mismatch (expected '${opts.rev ?? ''}'). Re-fetch /flows to get the current rev.`,
      );
    }
    if (!res.ok) {
      throw await httpError(res, 'POST /flows');
    }
    const text = await res.text();
    if (text.length === 0) return { rev: '' };
    try {
      const parsed = JSON.parse(text) as { rev?: string };
      return { rev: parsed.rev ?? '' };
    } catch {
      return { rev: '' };
    }
  }

  async getFlowsState(): Promise<{ state: string }> {
    const res = await this.request('GET', '/flows/state', undefined, {
      Accept: 'application/json',
    });
    if (!res.ok) throw await httpError(res, 'GET /flows/state');
    const json = (await res.json()) as { state?: string };
    return { state: json.state ?? 'unknown' };
  }

  /**
   * Toggle the Node-RED flow runtime state. Requires `runtimeState.enabled = true`
   * in settings.js — Node-RED returns 404 otherwise.
   */
  async setFlowsState(state: 'start' | 'stop'): Promise<{ state: string }> {
    const res = await this.request('POST', '/flows/state', JSON.stringify({ state }), {
      Accept: 'application/json',
      'content-type': 'application/json',
    });
    if (res.status === 404) {
      throw new FeatureDisabledError(
        'runtimeState.disabled',
        'POST /flows/state: Node-RED runtimeState API is not enabled in settings.js (runtimeState.enabled = true).',
      );
    }
    if (!res.ok) throw await httpError(res, `POST /flows/state state=${state}`);
    const json = (await res.json().catch(() => ({}))) as { state?: string };
    return { state: json.state ?? state };
  }

  async getSettings(): Promise<Record<string, unknown>> {
    const res = await this.request('GET', '/settings', undefined, {
      Accept: 'application/json',
    });
    if (!res.ok) throw await httpError(res, 'GET /settings');
    return (await res.json()) as Record<string, unknown>;
  }

  async getDiagnostics(): Promise<Record<string, unknown>> {
    const res = await this.request('GET', '/diagnostics', undefined, {
      Accept: 'application/json',
    });
    if (!res.ok) throw await httpError(res, 'GET /diagnostics');
    return (await res.json()) as Record<string, unknown>;
  }

  async getNodeTypes(): Promise<unknown> {
    const res = await this.request('GET', '/nodes', undefined, {
      Accept: 'application/json',
    });
    if (!res.ok) throw await httpError(res, 'GET /nodes');
    return await res.json();
  }

  /**
   * Single-flow CRUD endpoints — the right primitive for incremental authoring
   * (no full-document round-trips). Available since Node-RED 0.19, stable
   * through 5.0-beta. The `flow` body shape is `{id, label, nodes, configs?}`.
   */
  async getFlow(flowId: string): Promise<unknown> {
    const res = await this.request('GET', `/flow/${encodeURIComponent(flowId)}`, undefined, {
      Accept: 'application/json',
    });
    if (!res.ok) throw await httpError(res, `GET /flow/${flowId}`);
    return await res.json();
  }

  async createFlow(flow: unknown): Promise<{ id: string }> {
    const res = await this.request('POST', '/flow', JSON.stringify(flow), {
      'content-type': 'application/json',
      Accept: 'application/json',
    });
    if (!res.ok) throw await httpError(res, 'POST /flow');
    const json = (await res.json()) as { id?: string };
    if (typeof json.id !== 'string') {
      throw new NodeRedHttpError(
        res.status,
        JSON.stringify(json).slice(0, 200),
        'POST /flow: response missing id field.',
      );
    }
    return { id: json.id };
  }

  async updateFlow(flowId: string, flow: unknown): Promise<void> {
    const res = await this.request(
      'PUT',
      `/flow/${encodeURIComponent(flowId)}`,
      JSON.stringify(flow),
      { 'content-type': 'application/json', Accept: 'application/json' },
    );
    if (!res.ok) throw await httpError(res, `PUT /flow/${flowId}`);
  }

  async deleteFlow(flowId: string): Promise<void> {
    const res = await this.request('DELETE', `/flow/${encodeURIComponent(flowId)}`, undefined, {
      Accept: 'application/json',
    });
    if (!res.ok) throw await httpError(res, `DELETE /flow/${flowId}`);
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    pathname: string,
    body: string | undefined,
    headers: Record<string, string>,
  ): Promise<Response> {
    const url = new URL(pathname, this.opts.baseUrl).toString();
    const userAgent = this.opts.userAgent ?? DEFAULT_USER_AGENT;
    const buildHeaders = async (): Promise<Record<string, string>> => {
      const auth = await this.opts.auth.getAuthHeader();
      const h: Record<string, string> = { 'User-Agent': userAgent, ...headers };
      if (auth !== null) h[auth.name] = auth.value;
      return h;
    };
    let finalHeaders = await buildHeaders();

    let lastErr: unknown;
    let totalAttempts = this.retries + 1;
    let authReissued = false;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: finalHeaders,
          ...(body !== undefined ? { body } : {}),
          signal: controller.signal,
        });
        if (res.status === 401) {
          // Token may be stale (server restart cleared .sessions.json, etc.).
          // Drop the cached token, re-grant once, and retry. If it still 401s,
          // the credentials are genuinely wrong and we surface AuthFailedError.
          if (!authReissued) {
            authReissued = true;
            this.opts.auth.invalidate();
            finalHeaders = await buildHeaders();
            totalAttempts += 1; // auth reissue gets its own slot, distinct from the 5xx retry budget
            this.opts.logger?.warn(
              { url },
              'Node-RED 401; invalidated cached auth and retrying once',
            );
            continue;
          }
          throw new AuthFailedError(res.status, `${method} ${pathname}: HTTP 401`);
        }
        if (res.status === 403) {
          // 403 has two meanings in Node-RED: (a) auth/permission denied, or
          // (b) feature administratively disabled (e.g. {code:"diagnostics.disabled"}).
          // Peek at the body to disambiguate.
          const body = await res.text().catch(() => '');
          let code: string | undefined;
          try {
            const parsed = JSON.parse(body) as { code?: unknown };
            if (typeof parsed.code === 'string') code = parsed.code;
          } catch {
            // body wasn't JSON; fall through to AuthFailedError
          }
          if (code !== undefined && code.endsWith('.disabled')) {
            throw new FeatureDisabledError(
              code,
              `${method} ${pathname}: feature disabled (${code}).`,
            );
          }
          throw new AuthFailedError(
            res.status,
            `${method} ${pathname}: HTTP 403${code !== undefined ? ` (${code})` : ''}`,
          );
        }
        if (res.status >= 500 && attempt + 1 < totalAttempts) {
          this.opts.logger?.warn({ url, attempt, status: res.status }, 'Node-RED 5xx; retrying');
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (err instanceof AuthFailedError) throw err;
        if (err instanceof FeatureDisabledError) throw err;
        if (attempt + 1 < totalAttempts) {
          this.opts.logger?.warn(
            { url, attempt, error: String(err) },
            'Node-RED request failed; retrying',
          );
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new NodeRedDownError(
      `Could not reach Node-RED at ${url} after ${totalAttempts} attempt(s).`,
      lastErr,
    );
  }
}

function parseFlowsResponse(parsed: unknown, res: Response): FlowsResponse {
  // We always send `Node-RED-API-Version: v2` on GET /flows, so Node-RED returns
  // `{flows, rev}` since 0.15.0. The legacy v1 fallback that read x-rev/rev
  // headers was dead code — Node-RED never sends those headers. Pre-0.15
  // runtimes are unsupported.
  if (typeof parsed === 'object' && parsed !== null && 'flows' in parsed) {
    const obj = parsed as { flows: unknown; rev?: unknown };
    const flows = FlowsJsonSchema.parse(obj.flows);
    return { flows, rev: typeof obj.rev === 'string' ? obj.rev : null };
  }
  throw new NodeRedHttpError(
    res.status,
    JSON.stringify(parsed).slice(0, 200),
    'GET /flows: response did not match expected v2 {flows,rev} shape. Node-RED 0.15+ required.',
  );
}

async function httpError(res: Response, op: string): Promise<NodeRedHttpError> {
  const body = await res.text().catch(() => '');
  return new NodeRedHttpError(res.status, body, `${op}: HTTP ${res.status} ${res.statusText}`);
}
