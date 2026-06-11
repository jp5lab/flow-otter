/**
 * REND-1 — shared Chrome DevTools Protocol (CDP) module.
 *
 * The SINGLE browser-automation stack for the editor ground-truth capture
 * (REND-1, scripts/editor-metrics-dump.mjs), the renderer-fidelity harness
 * (REND-7, scripts/editor-fidelity-check.mjs) and the eval driver's
 * screenshot legs (EVAL-2). Built on the existing `ws` runtime dependency —
 * no playwright/puppeteer is added (fix-plan amendment; `puppeteer-core`
 * is the documented fallback if raw CDP ever proves brittle).
 *
 * API (consumed by all three callers):
 *
 *   const chrome = await launchChrome({ chromePath?, port?, userDataDir? });
 *   const session = await connect({ port: chrome.port });
 *   await session.navigate('http://localhost:1880/');
 *   await session.waitFor('window.RED && !!RED.nodes', { timeoutMs: 30000 });
 *   const value = await session.evaluate('1 + 1');        // returnByValue
 *   const big = await session.dump('({...})');            // JSON.stringify in-page
 *   await session.screenshot({ path: '/tmp/editor.png' });
 *   await session.close();
 *   await chrome.kill();
 *
 * Everything talks to 127.0.0.1 only — never a remote host.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSocket } from 'ws';

export const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export class CdpError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CdpError';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bind port 0, read the assigned port, release it. */
export async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new CdpError(`Non-JSON response from ${url}: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new CdpError(`Timeout fetching ${url}`)));
    req.on('error', reject);
  });
}

/**
 * Spawn a headless Chrome with the DevTools endpoint open on a local port.
 * Returns `{ proc, port, userDataDir, kill() }`. `kill()` is SIGTERM with a
 * SIGKILL fallback and always resolves.
 */
export async function launchChrome({
  chromePath = process.env.CHROME_PATH || DEFAULT_CHROME_PATH,
  port,
  userDataDir,
  windowSize = '1600,1200',
  extraArgs = [],
  startUrl = 'about:blank',
  timeoutMs = 20_000,
} = {}) {
  const debugPort = port ?? (await findFreePort());
  const dataDir = userDataDir ?? mkdtempSync(join(tmpdir(), 'foaudit-cdp-'));
  const args = [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${dataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    `--window-size=${windowSize}`,
    ...extraArgs,
    startUrl,
  ];
  const proc = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderrTail = '';
  proc.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });
  let exited = false;
  proc.on('exit', () => (exited = true));

  // Wait for the DevTools HTTP endpoint to answer.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exited) {
      throw new CdpError(`Chrome exited during startup. stderr tail:\n${stderrTail}`);
    }
    try {
      await httpGetJson(`http://127.0.0.1:${debugPort}/json/version`);
      break;
    } catch {
      if (Date.now() > deadline) {
        throw new CdpError(
          `DevTools endpoint on port ${debugPort} not ready after ${timeoutMs}ms. ` +
            `stderr tail:\n${stderrTail}`,
        );
      }
      await sleep(150);
    }
  }

  const kill = () =>
    new Promise((resolve) => {
      if (exited) return resolve();
      proc.on('exit', () => resolve());
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!exited) proc.kill('SIGKILL');
      }, 3000).unref();
      // Hard cap so a wedged Chrome never hangs the caller.
      setTimeout(() => resolve(), 5000).unref();
    });

  return { proc, port: debugPort, userDataDir: dataDir, kill };
}

class CdpSession {
  constructor(ws, targetInfo) {
    this.ws = ws;
    this.target = targetInfo;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = [];
    ws.on('message', (data) => this.#onMessage(data));
    ws.on('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new CdpError('CDP websocket closed'));
      }
      this.pending.clear();
    });
  }

  #onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new CdpError(`CDP error for command id ${msg.id}: ${msg.error.message}`));
      } else {
        resolve(msg.result);
      }
      return;
    }
    if (msg.method) {
      this.eventWaiters = this.eventWaiters.filter((w) => {
        if (w.method === msg.method) {
          w.resolve(msg.params ?? {});
          return false;
        }
        return true;
      });
    }
  }

  /** Raw CDP command. */
  send(method, params = {}, { timeoutMs = 30_000 } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`CDP command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Resolves the next occurrence of a CDP event. */
  once(method, { timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((w) => w.resolve !== wrapped);
        reject(new CdpError(`Timed out waiting for event ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();
      const wrapped = (params) => {
        clearTimeout(timer);
        resolve(params);
      };
      this.eventWaiters.push({ method, resolve: wrapped });
    });
  }

  /** Page.navigate + wait for the load event. */
  async navigate(url, { timeoutMs = 30_000 } = {}) {
    await this.send('Page.enable');
    const loaded = this.once('Page.loadEventFired', { timeoutMs });
    const nav = await this.send('Page.navigate', { url }, { timeoutMs });
    if (nav.errorText) throw new CdpError(`Navigation to ${url} failed: ${nav.errorText}`);
    await loaded;
    return nav;
  }

  /**
   * Runtime.evaluate with returnByValue. Throws CdpError on in-page
   * exceptions. Returns the JSON-serializable result value.
   */
  async evaluate(expression, { awaitPromise = true, timeoutMs = 30_000 } = {}) {
    const res = await this.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise },
      { timeoutMs },
    );
    if (res.exceptionDetails) {
      const detail =
        res.exceptionDetails.exception?.description ??
        res.exceptionDetails.text ??
        'unknown in-page exception';
      throw new CdpError(`evaluate() threw in page: ${detail}`);
    }
    return res.result?.value;
  }

  /**
   * Evaluate an expression producing a (possibly large) structure and
   * marshal it via in-page JSON.stringify — avoids deep-object serialization
   * limits in returnByValue.
   */
  async dump(expression, opts = {}) {
    const json = await this.evaluate(`JSON.stringify((${expression}))`, opts);
    if (typeof json !== 'string') {
      throw new CdpError('dump(): in-page JSON.stringify did not return a string');
    }
    return JSON.parse(json);
  }

  /** Poll an expression until truthy. */
  async waitFor(expression, { timeoutMs = 30_000, pollMs = 250 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let value;
      try {
        value = await this.evaluate(expression);
      } catch (err) {
        if (Date.now() > deadline) throw err;
        value = undefined;
      }
      if (value) return value;
      if (Date.now() > deadline) {
        throw new CdpError(`waitFor() timed out after ${timeoutMs}ms: ${expression}`);
      }
      await sleep(pollMs);
    }
  }

  /** Page.captureScreenshot → Buffer (and optional file). */
  async screenshot({ path, format = 'png', fullPage = false, timeoutMs = 30_000 } = {}) {
    const res = await this.send(
      'Page.captureScreenshot',
      { format, captureBeyondViewport: fullPage },
      { timeoutMs },
    );
    const buf = Buffer.from(res.data, 'base64');
    if (path) writeFileSync(path, buf);
    return buf;
  }

  /** Close the websocket (the browser process is owned by launchChrome). */
  async close() {
    if (this.ws.readyState === this.ws.OPEN) {
      await new Promise((resolve) => {
        this.ws.on('close', resolve);
        this.ws.close();
        setTimeout(resolve, 2000).unref();
      });
    }
  }
}

/**
 * Connect to a page target on a running DevTools endpoint. Picks the first
 * `type === 'page'` target (launchChrome starts exactly one, on about:blank).
 */
export async function connect({ port, host = '127.0.0.1', timeoutMs = 10_000 } = {}) {
  if (!port) throw new CdpError('connect() requires a port');
  const targets = await httpGetJson(`http://${host}:${port}/json/list`, timeoutMs);
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {
    throw new CdpError(
      `No debuggable page target on ${host}:${port} (targets: ${targets
        .map((t) => t.type)
        .join(', ')})`,
    );
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl, {
    maxPayload: 256 * 1024 * 1024,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new CdpError(`Websocket connect timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref();
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return new CdpSession(ws, page);
}
