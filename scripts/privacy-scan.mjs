#!/usr/bin/env node
/**
 * Privacy scanner for the public FlowOtter repository.
 *
 * FlowOtter is developed on personal workstations but published publicly
 * (GitHub + npm). This script scans repository content for private
 * information — LAN addresses, home-directory paths, emails, credentials,
 * machine fingerprints — before it can leak into a commit, a release
 * tarball, or the git history.
 *
 * Modes:
 *   node scripts/privacy-scan.mjs              # tracked + untracked-unignored text files
 *   node scripts/privacy-scan.mjs --staged     # added lines of the staged diff (pre-commit)
 *   node scripts/privacy-scan.mjs --history    # added lines across the entire git history
 *
 * Pattern sources:
 *   1. Built-in GENERIC patterns below (safe to publish — they describe
 *      classes of private data, not anyone's actual data).
 *   2. An OPTIONAL local file of personal patterns, one case-insensitive
 *      regex per line ('#' comments allowed), read from
 *      $FLOW_OTTER_PRIVACY_PATTERNS or ~/.flow-otter/privacy-patterns.txt.
 *      That file is personal to each maintainer and must NEVER be committed —
 *      a public deny-list would itself be the leak.
 *
 * Allowlist: scripts/privacy-allowlist.txt — literal substrings; a match is
 * suppressed when the matched text or its full line contains an entry.
 * Used for the sanctioned generic doc examples (e.g. 192.168.1.10).
 *
 * Exit codes: 0 clean · 1 findings · 2 usage/internal error.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts', 'privacy-allowlist.txt');

/** Generic pattern classes. Names show up in the report. */
const GENERIC_PATTERNS = [
  {
    name: 'rfc1918-ip',
    re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
  },
  { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'home-path', re: /(?:\/Users\/|\/home\/|C:\\Users\\)[A-Za-z0-9._-]+/g },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'npm-token', re: /_authToken|npm_[A-Za-z0-9]{30,}/g },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g },
  { name: 'ssh-pubkey', re: /\bssh-(?:rsa|ed25519|dss)\s+[A-Za-z0-9+/=]{40,}/g },
  { name: 'mac-address', re: /\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/g },
  { name: 'mdns-host', re: /\b[A-Za-z0-9][A-Za-z0-9-]*\.local\b/g },
  // Quoted secret-ish assignments. Placeholder-looking values are skipped in code below.
  {
    name: 'secret-assign',
    re: /(?:api[_-]?key|secret|password|passwd|access[_-]?token)\s*[:=]\s*['"][^'"]{12,}['"]/gi,
  },
];

const PLACEHOLDER_VALUES =
  /example|test|dummy|placeholder|changeme|not_available|your[-_]|<[^>]+>|xxx/i;

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.zip',
  '.gz',
  '.tgz',
]);

// The scanner and its allowlist inevitably contain the pattern vocabulary.
const SELF_FILES = new Set(['scripts/privacy-scan.mjs', 'scripts/privacy-allowlist.txt']);

function loadLines(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function loadAllowlist() {
  return existsSync(ALLOWLIST_PATH) ? loadLines(ALLOWLIST_PATH) : [];
}

function loadLocalPatterns() {
  const file =
    process.env.FLOW_OTTER_PRIVACY_PATTERNS ??
    path.join(homedir(), '.flow-otter', 'privacy-patterns.txt');
  if (!existsSync(file)) return [];
  return loadLines(file)
    .map((line, i) => {
      try {
        return { name: `local-${String(i + 1)}`, re: new RegExp(line, 'gi') };
      } catch {
        process.stderr.write(
          `privacy-scan: invalid regex in local patterns line ${String(i + 1)} (skipped)\n`,
        );
        return null;
      }
    })
    .filter((p) => p !== null);
}

function mask(text) {
  const t = text.length > 80 ? `${text.slice(0, 77)}...` : text;
  // Mask the middle of long token-like strings so the report itself is safe to share.
  return t.replace(/([A-Za-z0-9+/_-]{12})[A-Za-z0-9+/_-]{8,}([A-Za-z0-9+/_-]{4})/g, '$1…$2');
}

function scanLine(line, patterns, allowlist, findings, where) {
  for (const { name, re } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const matched = m[0];
      if (name === 'secret-assign' && PLACEHOLDER_VALUES.test(matched)) continue;
      if (allowlist.some((a) => matched.includes(a) || line.includes(a))) continue;
      findings.push({ where, pattern: name, excerpt: mask(matched) });
    }
  }
}

function listFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: REPO_ROOT },
  );
  return out.toString('utf8').split('\0').filter(Boolean);
}

function isBinary(filePath, buf) {
  if (BINARY_EXT.has(path.extname(filePath).toLowerCase())) return true;
  return buf.subarray(0, 8192).includes(0);
}

function scanWorktree(patterns, allowlist) {
  const findings = [];
  let skippedBinaries = 0;
  for (const rel of listFiles()) {
    if (SELF_FILES.has(rel)) continue;
    const abs = path.join(REPO_ROOT, rel);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    if (isBinary(rel, buf)) {
      skippedBinaries += 1;
      continue;
    }
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      scanLine(line, patterns, allowlist, findings, `${rel}:${String(i + 1)}`);
    });
  }
  if (skippedBinaries > 0) {
    process.stderr.write(
      `privacy-scan: ${String(skippedBinaries)} binary file(s) skipped — images need manual/vision review (see docs/EVALUATION.md hygiene section)\n`,
    );
  }
  return findings;
}

function scanDiffStream(args, patterns, allowlist) {
  const res = spawnSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 512 });
  if (res.status !== 0) {
    process.stderr.write(
      `privacy-scan: git ${args.join(' ')} failed: ${res.stderr.toString('utf8')}\n`,
    );
    process.exit(2);
  }
  const findings = [];
  let commit = 'staged';
  let file = '?';
  for (const line of res.stdout.toString('utf8').split('\n')) {
    if (line.startsWith('commit ')) {
      commit = line.slice(7, 19);
      continue;
    }
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++') && !SELF_FILES.has(file)) {
      scanLine(line.slice(1), patterns, allowlist, findings, `${commit}:${file}`);
    }
  }
  return findings;
}

function main() {
  const mode = process.argv[2] ?? '--worktree';
  const patterns = [...GENERIC_PATTERNS, ...loadLocalPatterns()];
  const allowlist = loadAllowlist();
  const localCount = patterns.length - GENERIC_PATTERNS.length;
  if (localCount === 0) {
    process.stderr.write(
      'privacy-scan: note: no local pattern file found — running generic patterns only\n',
    );
  }

  let findings;
  if (mode === '--worktree') findings = scanWorktree(patterns, allowlist);
  else if (mode === '--staged')
    findings = scanDiffStream(['diff', '--cached', '-U0'], patterns, allowlist);
  else if (mode === '--history')
    findings = scanDiffStream(['log', '--all', '-p', '-U0'], patterns, allowlist);
  else {
    process.stderr.write('Usage: privacy-scan.mjs [--worktree|--staged|--history]\n');
    process.exit(2);
  }

  for (const f of findings) {
    process.stdout.write(`LEAK? ${f.pattern.padEnd(14)} ${f.where}: ${f.excerpt}\n`);
  }
  process.stdout.write(
    `privacy-scan: ${String(findings.length)} finding(s) [mode ${mode}, ${String(patterns.length)} patterns (${String(localCount)} local), ${String(allowlist.length)} allowlist entries]\n`,
  );
  process.exit(findings.length > 0 ? 1 : 0);
}

main();
