import { AuthFailedError, NodeRedDownError } from './errors.js';

/**
 * Auth header pair. Most adminAuth setups put the bearer in `Authorization`;
 * reverse-proxy / SSO setups expose Node-RED behind a custom header set via
 * `adminAuth.tokenHeader`. The auth strategy returns the header it wants used
 * so the client doesn't have to know.
 */
export interface AuthHeader {
  readonly name: string;
  readonly value: string;
}

export interface NodeRedAuth {
  /**
   * Returns the header pair to send (`Authorization`, or `adminAuth.tokenHeader`
   * for reverse-proxy SSO). Null when unauthenticated.
   */
  getAuthHeader(): Promise<AuthHeader | null>;
  /**
   * Drop any cached token so the next `getAuthHeader()` re-acquires from source.
   * Called by the HTTP client on 401, so a server-side token revocation (e.g.
   * after a Node-RED restart that cleared `.sessions.json`) does not leave the
   * client stuck in a 401 loop until natural expiry.
   */
  invalidate(): void;
  /**
   * Best-effort revoke of any active token at shutdown. Default is no-op for
   * static / unauthenticated strategies. PasswordGrantAuth issues
   * `DELETE /auth/revoke` to free the server-side `.sessions.json` slot.
   */
  revoke(): Promise<void>;
}

export class NoAuth implements NodeRedAuth {
  // eslint-disable-next-line @typescript-eslint/require-await
  async getAuthHeader(): Promise<AuthHeader | null> {
    return null;
  }
  invalidate(): void {
    // no cached state to drop
  }
  async revoke(): Promise<void> {
    // no-op
  }
}

export interface BearerAuthOptions {
  /** Header name to send the token under. Defaults to `Authorization` (with `Bearer ` prefix). */
  headerName?: string;
}

export class BearerAuth implements NodeRedAuth {
  private readonly headerName: string;

  constructor(
    private readonly token: string,
    opts: BearerAuthOptions = {},
  ) {
    this.headerName = opts.headerName ?? 'Authorization';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAuthHeader(): Promise<AuthHeader | null> {
    if (this.headerName === 'Authorization') {
      return { name: 'Authorization', value: `Bearer ${this.token}` };
    }
    // Custom header (reverse-proxy / SSO setups) sends the raw token.
    return { name: this.headerName, value: this.token };
  }

  invalidate(): void {
    // Static token; no in-memory cache. A 401 with BearerAuth means the env
    // var holds a stale/wrong token — the operator must rotate it.
  }

  async revoke(): Promise<void> {
    // no server-side session to free
  }
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export interface PasswordGrantOptions {
  baseUrl: string;
  username: string;
  password: string;
  clientId?: string;
  scope?: string;
  fetchImpl?: typeof fetch;
  /** Returns ms-since-epoch. Defaults to `Date.now`. */
  clock?: () => number;
  /**
   * Override the auth header name. Defaults to `Authorization` (with `Bearer `
   * prefix). When Node-RED is behind a reverse proxy with
   * `adminAuth.tokenHeader: 'X-Auth-Token'`, set this to that header name and
   * the client will send the raw token (no `Bearer ` prefix).
   */
  headerName?: string;
}

const TOKEN_REFRESH_BUFFER_MS = 30_000;

export class PasswordGrantAuth implements NodeRedAuth {
  private cached: CachedToken | null = null;
  private readonly headerName: string;

  constructor(private readonly opts: PasswordGrantOptions) {
    this.headerName = opts.headerName ?? 'Authorization';
  }

  async getAuthHeader(): Promise<AuthHeader | null> {
    const now = (this.opts.clock ?? Date.now)();
    if (this.cached && this.cached.expiresAt - now > TOKEN_REFRESH_BUFFER_MS) {
      return this.formatHeader(this.cached.value);
    }
    const token = await this.fetchToken(now);
    this.cached = token;
    return this.formatHeader(token.value);
  }

  invalidate(): void {
    this.cached = null;
  }

  /**
   * `DELETE /auth/revoke` with the current token. Call at shutdown so the
   * server's `.sessions.json` doesn't accumulate dead tokens up to the
   * `sessionExpiryTime` (default 7 days).
   */
  async revoke(): Promise<void> {
    if (!this.cached) return;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = new URL('/auth/revoke', this.opts.baseUrl).toString();
    const body = new URLSearchParams({ token: this.cached.value }).toString();
    try {
      await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      // Best-effort; don't throw on shutdown path.
    }
    this.cached = null;
  }

  private formatHeader(token: string): AuthHeader {
    if (this.headerName === 'Authorization') {
      return { name: 'Authorization', value: `Bearer ${token}` };
    }
    return { name: this.headerName, value: token };
  }

  private async fetchToken(now: number): Promise<CachedToken> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = new URL('/auth/token', this.opts.baseUrl).toString();
    const body = new URLSearchParams({
      grant_type: 'password',
      scope: this.opts.scope ?? '*',
      username: this.opts.username,
      password: this.opts.password,
      client_id: this.opts.clientId ?? 'node-red-admin',
    });
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new NodeRedDownError(`Password grant request failed at ${url}.`, err);
    }
    if (!res.ok) {
      throw new AuthFailedError(res.status, `Password grant rejected (HTTP ${res.status}).`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof json.access_token !== 'string') {
      throw new AuthFailedError(res.status, 'Password grant response missing access_token.');
    }
    // Node-RED's adminAuth `sessionExpiryTime` defaults to 604800s (7 days). The
    // spec-style 3600s fallback masked this if the server omitted `expires_in`.
    const expiresInMs = (typeof json.expires_in === 'number' ? json.expires_in : 604_800) * 1000;
    return { value: json.access_token, expiresAt: now + expiresInMs };
  }
}

/**
 * Probe `GET /auth/login` to discover the auth scheme. Used at startup to
 * detect `adminAuth.tokenHeader` overrides for reverse-proxy / SSO setups.
 * Returns the discovered header name (or undefined if not exposed).
 */
export interface AuthLoginInfo {
  /** "credentials" (password grant), "strategy" (OAuth/SSO), or "none". */
  type: 'credentials' | 'strategy' | 'none';
  /**
   * The custom auth header name when `adminAuth.tokenHeader` is set on the
   * server. Undefined when the standard `Authorization` header is expected.
   */
  tokenHeader?: string;
}

export async function probeAuthLogin(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthLoginInfo> {
  const url = new URL('/auth/login', baseUrl).toString();
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
  } catch {
    return { type: 'none' };
  }
  if (res.status === 404 || res.status === 204) return { type: 'none' };
  if (!res.ok) return { type: 'none' };
  let body: { type?: unknown; tokenHeader?: unknown } | undefined;
  try {
    body = (await res.json()) as { type?: unknown; tokenHeader?: unknown };
  } catch {
    return { type: 'none' };
  }
  const type = body?.type === 'credentials' || body?.type === 'strategy' ? body.type : 'none';
  const tokenHeader = typeof body?.tokenHeader === 'string' ? body.tokenHeader : undefined;
  return tokenHeader !== undefined ? { type, tokenHeader } : { type };
}

export function authFromEnv(env: NodeJS.ProcessEnv, baseUrl: string): NodeRedAuth {
  const headerName = env['NODE_RED_AUTH_HEADER'];
  const token = env['NODE_RED_AUTH_TOKEN'];
  if (typeof token === 'string' && token.length > 0) {
    return new BearerAuth(token, headerName ? { headerName } : {});
  }
  const username = env['NODE_RED_USERNAME'];
  const password = env['NODE_RED_PASSWORD'];
  if (typeof username === 'string' && typeof password === 'string') {
    return new PasswordGrantAuth({
      baseUrl,
      username,
      password,
      ...(headerName ? { headerName } : {}),
    });
  }
  return new NoAuth();
}
