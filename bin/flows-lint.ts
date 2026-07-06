#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { FlowsJsonSchema } from '../src/shared/flows-json.js';
import { lintFlows, type FlowLintReport } from '../src/toolkit/lint/flows-lint.js';
import { loadNamingContract } from '../src/toolkit/naming/load.js';
import type { NamingContract } from '../src/toolkit/naming/schema.js';
import type { Diagnostic } from '../src/toolkit/validate/index.js';

export interface CliOptions {
  format: 'text' | 'json' | 'github';
  severity: 'error' | 'warning' | 'info';
  strict: boolean;
  quiet: boolean;
  verbose: boolean;
  layout: boolean;
  labelCap?: number;
  grid?: number;
  namingPath?: string;
  filePath?: string;
}

function usage(): string {
  return [
    'Usage: flows-lint [options] <path-to-flows.json>',
    '',
    'Options:',
    '  --format=text|json|github   Output format (default: text)',
    '  --severity=error|warning|info  Minimum severity that triggers exit 1 (default: error)',
    '  --strict                    Treat warnings as errors',
    '  --label-cap=<n>             Override label-cap chars (default 24)',
    '  --grid=<n>                  Override on-grid pixel size (default 20)',
    '  --naming=<path>             Path to a naming.yaml contract',
    '  --no-layout                 Omit scored layout lint from diagnostics and JSON output',
    '  --quiet                     Suppress non-diagnostic output',
    '  --verbose                   Print extra context',
    '  -h, --help                  Show this help',
    '',
    'Exit codes: 0 clean, 1 diagnostics ≥ severity threshold, 2 usage / IO error',
  ].join('\n');
}

export function parseArgs(
  argv: string[],
): { ok: true; opts: CliOptions } | { ok: false; error: string } {
  const opts: CliOptions = {
    format: 'text',
    severity: 'error',
    strict: false,
    quiet: false,
    verbose: false,
    layout: true,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') return { ok: false, error: 'help' };
    if (a === '--strict') {
      opts.strict = true;
      continue;
    }
    if (a === '--quiet') {
      opts.quiet = true;
      continue;
    }
    if (a === '--verbose') {
      opts.verbose = true;
      continue;
    }
    if (a === '--no-layout') {
      opts.layout = false;
      continue;
    }
    if (a.startsWith('--format=')) {
      const v = a.slice('--format='.length);
      if (v !== 'text' && v !== 'json' && v !== 'github')
        return { ok: false, error: `Unknown --format: ${v}` };
      opts.format = v;
      continue;
    }
    if (a.startsWith('--severity=')) {
      const v = a.slice('--severity='.length);
      if (v !== 'error' && v !== 'warning' && v !== 'info')
        return { ok: false, error: `Unknown --severity: ${v}` };
      opts.severity = v;
      continue;
    }
    if (a.startsWith('--label-cap=')) {
      const n = Number.parseInt(a.slice('--label-cap='.length), 10);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Invalid --label-cap' };
      opts.labelCap = n;
      continue;
    }
    if (a.startsWith('--grid=')) {
      const n = Number.parseInt(a.slice('--grid='.length), 10);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Invalid --grid' };
      opts.grid = n;
      continue;
    }
    if (a.startsWith('--naming=')) {
      opts.namingPath = a.slice('--naming='.length);
      continue;
    }
    if (a.startsWith('-')) return { ok: false, error: `Unknown flag: ${a}` };
    if (opts.filePath !== undefined) return { ok: false, error: 'Multiple file paths given.' };
    opts.filePath = a;
  }
  if (opts.filePath === undefined)
    return { ok: false, error: 'Missing <path-to-flows.json> argument.' };
  return { ok: true, opts };
}

const SEVERITY_ORDER: Record<'error' | 'warning' | 'info', number> = {
  error: 2,
  warning: 1,
  info: 0,
};

function meetsThreshold(
  d: Diagnostic,
  threshold: 'error' | 'warning' | 'info',
  strict: boolean,
): boolean {
  if (strict && d.severity === 'warning') return true;
  return SEVERITY_ORDER[d.severity] >= SEVERITY_ORDER[threshold];
}

function formatText(report: FlowLintReport, opts: CliOptions): string {
  const lines: string[] = [];
  if (!opts.quiet) {
    lines.push(
      `flows-lint: ${report.errors.length} error(s), ${report.warnings.length} warning(s)`,
    );
    if (report.layout !== undefined) {
      lines.push(`flows-lint: layout score ${report.layout.overall.toFixed(2)}`);
    }
  }
  for (const d of report.diagnostics) {
    if (opts.quiet && d.severity !== 'error' && !(opts.strict && d.severity === 'warning'))
      continue;
    const tag = d.severity.toUpperCase().padEnd(5);
    const where = d.nodeId !== undefined ? `[${d.nodeId}]` : '';
    lines.push(`${tag} ${d.rule.padEnd(28)} ${where} ${d.message}`);
  }
  return lines.join('\n');
}

export function formatJson(report: FlowLintReport, file: string): string {
  return JSON.stringify(
    {
      file,
      errors: report.errors.length,
      warnings: report.warnings.length,
      diagnostics: report.diagnostics,
      ...(report.layout !== undefined ? { layout: report.layout } : {}),
    },
    null,
    2,
  );
}

function formatGithub(report: FlowLintReport, file: string): string {
  const lines: string[] = [];
  for (const d of report.diagnostics) {
    const level =
      d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'notice';
    const ctx = d.context as { line?: unknown; column?: unknown } | undefined;
    const line = typeof ctx?.line === 'number' ? `,line=${String(ctx.line)}` : '';
    const col = typeof ctx?.column === 'number' ? `,col=${String(ctx.column)}` : '';
    lines.push(`::${level} file=${file}${line}${col}::${d.rule}: ${d.message}`);
  }
  return lines.join('\n');
}

export function exitCodeForReport(report: FlowLintReport, opts: CliOptions): number {
  const failing = report.diagnostics.some((d) => meetsThreshold(d, opts.severity, opts.strict));
  return failing ? 1 : 0;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    if (parsed.error === 'help') {
      process.stdout.write(usage() + '\n');
      return 0;
    }
    process.stderr.write(`flows-lint: ${parsed.error}\n${usage()}\n`);
    return 2;
  }
  const opts = parsed.opts;
  const file = path.resolve(opts.filePath!);

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    process.stderr.write(
      `flows-lint: cannot read '${file}': ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `flows-lint: invalid JSON in '${file}': ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  let flows;
  try {
    flows = FlowsJsonSchema.parse(parsedJson);
  } catch (err) {
    process.stderr.write(
      `flows-lint: not a valid flows.json: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  let namingContract: NamingContract | undefined;
  if (opts.namingPath !== undefined) {
    try {
      const loaded = loadNamingContract(opts.namingPath);
      if (loaded === null) {
        process.stderr.write(`flows-lint: naming contract not found at '${opts.namingPath}'\n`);
        return 2;
      }
      namingContract = loaded;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`flows-lint: ${msg}\n`);
      return 2;
    }
  }

  const lintOpts: {
    labelCap?: number;
    grid?: number;
    namingContract?: NamingContract;
    layout?: boolean;
  } = {};
  if (opts.labelCap !== undefined) lintOpts.labelCap = opts.labelCap;
  if (opts.grid !== undefined) lintOpts.grid = opts.grid;
  if (namingContract !== undefined) lintOpts.namingContract = namingContract;
  if (opts.layout) lintOpts.layout = true;
  const report = lintFlows(flows, lintOpts);

  let output: string;
  if (opts.format === 'json') output = formatJson(report, file);
  else if (opts.format === 'github') output = formatGithub(report, file);
  else output = formatText(report, opts);
  if (output.length > 0) process.stdout.write(output + '\n');

  return exitCodeForReport(report, opts);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(
        `flows-lint: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(2);
    });
}
