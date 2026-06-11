/** Hand-written declarations for cdp.mjs (consumed by TS tests/harnesses). */

export declare const DEFAULT_CHROME_PATH: string;

export declare class CdpError extends Error {
  constructor(message: string);
}

export declare function findFreePort(): Promise<number>;

export interface LaunchedChrome {
  proc: import('node:child_process').ChildProcess;
  port: number;
  userDataDir: string;
  kill(): Promise<void>;
}

export interface LaunchChromeOptions {
  chromePath?: string;
  port?: number;
  userDataDir?: string;
  windowSize?: string;
  extraArgs?: string[];
  startUrl?: string;
  timeoutMs?: number;
}

export declare function launchChrome(options?: LaunchChromeOptions): Promise<LaunchedChrome>;

export interface CdpSession {
  send(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<Record<string, unknown>>;
  once(method: string, opts?: { timeoutMs?: number }): Promise<Record<string, unknown>>;
  navigate(url: string, opts?: { timeoutMs?: number }): Promise<Record<string, unknown>>;
  evaluate(
    expression: string,
    opts?: { awaitPromise?: boolean; timeoutMs?: number },
  ): Promise<unknown>;
  dump(expression: string, opts?: { awaitPromise?: boolean; timeoutMs?: number }): Promise<unknown>;
  waitFor(expression: string, opts?: { timeoutMs?: number; pollMs?: number }): Promise<unknown>;
  screenshot(opts?: {
    path?: string;
    format?: 'png' | 'jpeg' | 'webp';
    fullPage?: boolean;
    timeoutMs?: number;
  }): Promise<Buffer>;
  close(): Promise<void>;
}

export declare function connect(opts: {
  port: number;
  host?: string;
  timeoutMs?: number;
}): Promise<CdpSession>;
