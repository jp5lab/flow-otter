import { spawn } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const CLI_PATH = path.resolve(__dirname, '../../dist/bin/flows-lint.js');
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/broken');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

describe('flows-lint CLI', () => {
  it('exits 0 on the clean fixture', async () => {
    const out = await runCli([path.join(FIXTURES_DIR, 'clean.flows.json'), '--strict']);
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/0 error\(s\), 0 warning\(s\)/);
  });

  const broken: { fixture: string; rule: string }[] = [
    { fixture: 'function-syntax.flows.json', rule: 'function-syntax' },
    { fixture: 'link-resolution.flows.json', rule: 'link-resolution' },
    { fixture: 'subflow-ports.flows.json', rule: 'subflow-ports' },
    {
      fixture: 'dashboard-hierarchy-widget-no-group.flows.json',
      rule: 'dashboard-hierarchy',
    },
    {
      fixture: 'dashboard-hierarchy-group-no-page.flows.json',
      rule: 'dashboard-hierarchy',
    },
    {
      fixture: 'dashboard-hierarchy-page-no-base.flows.json',
      rule: 'dashboard-hierarchy',
    },
    { fixture: 'tab-divergence.flows.json', rule: 'tab-divergence' },
    { fixture: 'naming-contract.flows.json', rule: 'naming-contract' },
    { fixture: 'credential-leak.flows.json', rule: 'credential-leak' },
    { fixture: 'function-side-effects.flows.json', rule: 'function-side-effects' },
  ];

  for (const { fixture, rule } of broken) {
    it(`exits 1 with rule '${rule}' for fixture ${fixture}`, async () => {
      const out = await runCli([path.join(FIXTURES_DIR, fixture), '--strict']);
      expect(out.code, `stdout: ${out.stdout}\nstderr: ${out.stderr}`).toBe(1);
      expect(out.stdout).toContain(rule);
    });
  }

  it('exit 2 on missing file', async () => {
    const out = await runCli([path.join(FIXTURES_DIR, 'does-not-exist.flows.json')]);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain('cannot read');
  });

  it('--format=json emits machine-parseable output', async () => {
    const out = await runCli([
      path.join(FIXTURES_DIR, 'function-syntax.flows.json'),
      '--format=json',
    ]);
    expect(out.code).toBe(1);
    const payload = JSON.parse(out.stdout) as { errors: number; diagnostics: unknown[] };
    expect(payload.errors).toBe(1);
    expect(payload.diagnostics.length).toBeGreaterThanOrEqual(1);
  });
});
