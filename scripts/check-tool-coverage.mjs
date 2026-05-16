#!/usr/bin/env node
/**
 * Per-tool coverage audit. Walks `src/server/tools/**\/*.ts` to extract MCP
 * tool names from `name: '<...>'` declarations, then verifies each has:
 *   - at least one unit test file that imports or names the tool
 *   - at least one integration test that calls it via `callTool(...)`
 *
 * Exits 0 with a coverage table on success; exits 1 if any tool lacks
 * either unit or integration coverage. Output is plain text — no deps.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL_DIR = path.join(ROOT, 'src/server/tools');
const UNIT_DIR = path.join(ROOT, 'tests/unit/server/tools');
const INTEGRATION_DIR = path.join(ROOT, 'tests/integration');

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (ent.isFile() && ent.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function extractToolName(src) {
  // Matches `name: 'something'` in a tool definition; only one per file.
  const m = src.match(/name:\s*'([a-z_][a-z0-9_]*)'/);
  return m ? m[1] : null;
}

async function readAll(dir) {
  const files = await walk(dir);
  return Promise.all(files.map(async (f) => ({ path: f, src: await readFile(f, 'utf8') })));
}

async function main() {
  const toolFiles = (await readAll(TOOL_DIR)).filter(
    ({ path: p }) =>
      !p.endsWith('_tool.ts') &&
      !p.endsWith('register.ts') &&
      !p.endsWith('_confirmation.ts') &&
      !p.endsWith('_stage-pipeline.ts'),
  );
  const tools = toolFiles
    .map((f) => ({ path: f.path, name: extractToolName(f.src) }))
    .filter((t) => t.name !== null);

  const unitFiles = await readAll(UNIT_DIR);
  const integrationFiles = await readAll(INTEGRATION_DIR);

  function camelTool(snakeName) {
    return snakeName.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) + 'Tool';
  }

  const results = [];
  for (const tool of tools) {
    const camelVar = camelTool(tool.name);
    const unitHit = unitFiles.find(
      (f) => f.src.includes(`'${tool.name}'`) || f.src.includes(camelVar),
    );
    // For integration, require the tool to actually appear in a callTool() invocation.
    const integrationHit = integrationFiles.find(
      (f) =>
        f.src.includes(`'${tool.name}'`) &&
        (f.src.includes(`callTool(`) || f.src.includes('listTools()')),
    );
    results.push({
      name: tool.name,
      tier: path.basename(path.dirname(tool.path)),
      unit: unitHit ? path.relative(ROOT, unitHit.path) : null,
      integration: integrationHit ? path.relative(ROOT, integrationHit.path) : null,
    });
  }

  // Sort for stable output.
  results.sort((a, b) => (a.tier + '/' + a.name).localeCompare(b.tier + '/' + b.name));

  let nMissingUnit = 0;
  let nMissingIntegration = 0;
  const lines = [];
  lines.push(`Per-tool coverage audit (${results.length} tools)`);
  lines.push('');
  lines.push(`${'TIER'.padEnd(10)}${'TOOL'.padEnd(36)}${'UNIT'.padEnd(8)}${'INTEGR'.padEnd(8)}`);
  lines.push('-'.repeat(62));
  for (const r of results) {
    const unitOk = r.unit ? 'OK' : 'MISS';
    const intOk = r.integration ? 'OK' : 'MISS';
    if (!r.unit) nMissingUnit += 1;
    if (!r.integration) nMissingIntegration += 1;
    lines.push(`${r.tier.padEnd(10)}${r.name.padEnd(36)}${unitOk.padEnd(8)}${intOk.padEnd(8)}`);
  }
  lines.push('');
  lines.push(
    `Summary: ${results.length} tools | missing unit: ${nMissingUnit} | missing integration: ${nMissingIntegration}`,
  );

  const summary = lines.join('\n');
  process.stdout.write(summary + '\n');

  if (nMissingUnit > 0 || nMissingIntegration > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`coverage check failed: ${String(err)}\n`);
  process.exit(2);
});
