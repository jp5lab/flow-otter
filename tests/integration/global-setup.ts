import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = path.resolve(HERE, '../../deploy/docker-compose.yml');
const FIXTURE_PATH = path.resolve(HERE, '../fixtures/inject-to-debug.flows.json');
const NR_BASE = process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880';

export const FIXTURE_TAB_ID = '1111111111111111';
export const FIXTURE_INJECT_ID = '2222222222222222';

async function waitForFlows(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/flows`, { headers: { Accept: 'application/json' } });
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Node-RED never became ready at ${baseUrl}: ${String(lastErr)}`);
}

async function seedFixture(baseUrl: string, fixturePath: string): Promise<void> {
  const raw = await readFile(fixturePath, 'utf8');
  // Seed using v1 (array) format so any prior rev is reset.
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Node-RED-Deployment-Type': 'full',
    },
    body: raw,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to seed fixture: HTTP ${res.status} ${body}`);
  }
}

export async function setup(): Promise<void> {
  if (process.env['SKIP_DOCKER'] === 'true') return;
  process.stdout.write(`[integration] starting compose stack at ${COMPOSE_FILE}\n`);
  try {
    execSync(`docker compose -f "${COMPOSE_FILE}" up -d --wait`, { stdio: 'inherit' });
  } catch (err) {
    throw new Error(`docker compose up failed. Is Docker running? Detail: ${String(err)}`);
  }
  await waitForFlows(NR_BASE, 60_000);
  await seedFixture(NR_BASE, FIXTURE_PATH);
  process.stdout.write(`[integration] Node-RED ready at ${NR_BASE} with fixture seeded\n`);
}

export function teardown(): void {
  if (process.env['SKIP_DOCKER'] === 'true') return;
  if (process.env['KEEP_STACK'] === 'true') {
    process.stdout.write(`[integration] KEEP_STACK=true; leaving stack running\n`);
    return;
  }
  try {
    execSync(`docker compose -f "${COMPOSE_FILE}" down -v`, { stdio: 'inherit' });
  } catch (err) {
    process.stderr.write(`[integration] compose down failed: ${String(err)}\n`);
  }
}
