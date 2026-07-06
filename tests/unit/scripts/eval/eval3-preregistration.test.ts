/**
 * EVAL-3 — pins the S6 benchmark pre-registration: canonical audit corpus,
 * hash-verified fixtures, leg-B zero-coordinate assertions, and frozen
 * layout_lint thresholds. These are pins, not suggestions; silent edits to
 * the corpus, protocol, or thresholds must go loud before EVAL-4 can score.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  audit20260610FixturePath,
  loadAudit20260610FixtureJson,
  readAudit20260610FixtureBytes,
  readAudit20260610HashManifest,
} from '../../../fixtures/audit-2026-06-10/loader.js';
import { FlowsJsonSchema, type FlowsJson } from '../../../../src/shared/flows-json.js';
import { layoutLint } from '../../../../src/toolkit/lint/layout-lint.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../');
const BENCHMARK_DIR = path.join(ROOT, 'eval/benchmark');
const MANIFEST_PATH = path.join(BENCHMARK_DIR, 'manifest.json');
const THRESHOLDS_PATH = path.join(BENCHMARK_DIR, 'thresholds.json');
const PROTOCOL_PATH = path.join(BENCHMARK_DIR, 'PROTOCOL.md');
const SPECS_DIR = path.join(BENCHMARK_DIR, 'specs');
const DESIGN_PATH = path.join(ROOT, 'docs/DESIGN.md');
const FIXTURE_DIR = path.join(ROOT, 'tests/fixtures/audit-2026-06-10');
const FIXTURE_MANIFEST_PATH = path.join(FIXTURE_DIR, 'sha256-manifest.json');

const SHA256_RE = /^[0-9a-f]{64}$/u;
const FROZEN_RULES = [
  { rule: 'layout-stage-order', weight: 2 },
  { rule: 'layout-group-overlap', weight: 2 },
  { rule: 'layout-header-presence', weight: 1 },
  { rule: 'layout-error-lane-below', weight: 2 },
  { rule: 'layout-affirmative-on-top', weight: 1 },
  { rule: 'layout-wire-crossings', weight: 3 },
  { rule: 'layout-backward-wires', weight: 3 },
  { rule: 'layout-viewport-overflow', weight: 1 },
] as const;

interface BenchmarkManifest {
  readonly schema_version: number;
  readonly entry_source_schema: {
    readonly community_remote: {
      readonly required: readonly string[];
    };
  };
  readonly entries: readonly ManifestEntry[];
  readonly community_entries: readonly unknown[];
}

interface ManifestEntry {
  readonly id: string;
  readonly kind: string;
  readonly source: {
    readonly type: string;
    readonly path: string;
    readonly sha256: string;
  };
  readonly operator_semantics_criteria: readonly {
    readonly id: string;
    readonly description: string;
  }[];
}

interface ThresholdRule {
  readonly rule: string;
  readonly score: number;
  readonly weight: number;
  readonly offender_count: number;
}

interface ThresholdEntry {
  readonly id: string;
  readonly source_sha256: string;
  readonly overall: number;
  readonly rules: readonly ThresholdRule[];
}

interface Thresholds {
  readonly layout_lint_contract: {
    readonly score_range: readonly [number, number];
    readonly rules: readonly { readonly rule: string; readonly weight: number }[];
  };
  readonly first_benchmark_run: {
    readonly entries: readonly ThresholdEntry[];
  };
  readonly r4_separation: {
    readonly score_ordering_margin: number;
    readonly spag_raw: {
      readonly 'layout-backward-wires': { readonly offender_count: number };
      readonly 'layout-wire-crossings': { readonly minimum_offender_count: number };
    };
    readonly engine_outputs: {
      readonly 'layout-group-overlap': { readonly minimum_offender_count: number };
      readonly 'comment-pile': { readonly offender_count: number };
      readonly 'off-canvas-groups': { readonly offender_count: number };
      readonly 'layout-error-lane-below': { readonly fires: boolean };
    };
    readonly e1_agent: {
      readonly occlusion: {
        readonly maximum_offender_count: number;
        readonly maximum_severity: string;
      };
      readonly f11_true_positives_expected: boolean;
    };
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function fixtureSnapshot(name: 'e1-flows.json' | 'e2-flows.json'): { readonly flows: unknown } {
  const parsed = loadAudit20260610FixtureJson(name);
  if (typeof parsed !== 'object' || parsed === null || !('flows' in parsed)) {
    throw new Error(`${name} is not a Node-RED flows snapshot`);
  }
  return parsed;
}

function parseFlows(name: 'e1-flows.json' | 'e2-flows.json'): FlowsJson {
  return FlowsJsonSchema.parse(fixtureSnapshot(name).flows);
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(fullPath));
    else out.push(fullPath);
  }
  return out.sort();
}

function parseStructuredSpec(filePath: string): unknown {
  const ext = path.extname(filePath);
  if (ext === '.json') return readJson<unknown>(filePath);
  if (ext === '.yaml' || ext === '.yml') return parseYaml(readFileSync(filePath, 'utf8'));
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeLike(value: Record<string, unknown>): boolean {
  const hasType = typeof value['type'] === 'string' || typeof value['kind'] === 'string';
  const hasIdentity =
    typeof value['id'] === 'string' ||
    typeof value['key'] === 'string' ||
    typeof value['name'] === 'string';
  return hasType && hasIdentity;
}

function assertNoNonJunctionNodePositionKeys(value: unknown, breadcrumb = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoNonJunctionNodePositionKeys(item, `${breadcrumb}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) return;

  if (isNodeLike(value)) {
    const nodeType = value['type'] ?? value['kind'];
    const isJunction = nodeType === 'junction';
    if ('position' in value) {
      throw new Error(`${breadcrumb} has disallowed position key`);
    }
    if (!isJunction) {
      for (const key of ['x', 'y']) {
        if (key in value) throw new Error(`${breadcrumb} has disallowed ${key} key`);
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    assertNoNonJunctionNodePositionKeys(child, `${breadcrumb}.${key}`);
  }
}

function normalizedRules(rules: readonly ThresholdRule[]): readonly {
  readonly rule: string;
  readonly score: number;
  readonly weight: number;
  readonly offender_count: number;
}[] {
  return rules.map((r) => ({
    rule: r.rule,
    score: r.score,
    weight: r.weight,
    offender_count: r.offender_count,
  }));
}

function reportRules(flows: FlowsJson): readonly {
  readonly rule: string;
  readonly score: number;
  readonly weight: number;
  readonly offender_count: number;
}[] {
  return layoutLint(flows).rules.map((r) => ({
    rule: r.rule,
    score: r.score,
    weight: r.weight,
    offender_count: r.offenders.length,
  }));
}

describe('EVAL-3 benchmark manifest', () => {
  it('pins the two charter fixtures and requires operator-semantics criteria', () => {
    const manifest = readJson<BenchmarkManifest>(MANIFEST_PATH);

    expect(manifest.schema_version).toBe(1);
    expect(manifest.community_entries).toEqual([]);
    expect(manifest.entry_source_schema.community_remote.required).toEqual([
      'url',
      'sha256',
      'license',
    ]);

    const entriesById = new Map(manifest.entries.map((entry) => [entry.id, entry]));
    expect([...entriesById.keys()].sort()).toEqual(['audit-2026-06-10-e1', 'audit-2026-06-10-e2']);

    for (const entry of manifest.entries) {
      expect(entry.kind).toBe('charter');
      expect(entry.operator_semantics_criteria.length).toBeGreaterThanOrEqual(1);
      for (const criterion of entry.operator_semantics_criteria) {
        expect(criterion.id.trim()).not.toBe('');
        expect(criterion.description.trim()).not.toBe('');
      }

      expect(entry.source.type).toBe('fixture');
      expect(entry.source.sha256).toMatch(SHA256_RE);
      const sourcePath = path.resolve(BENCHMARK_DIR, entry.source.path);
      expect(existsSync(sourcePath)).toBe(true);
      expect(sha256File(sourcePath)).toBe(entry.source.sha256);
    }
  });
});

describe('canonical audit fixture loader', () => {
  it('hash-verifies all pinned fixture files', () => {
    const manifest = readAudit20260610HashManifest();
    expect(manifest.files).toEqual({
      'e1-flows.json': 'ba8ac47e906a7c0a34ee31c1a18a86787a0780456dfbb677870593bb313111f1',
      'e2-flows.json': '21dce7e6ad41d9e3777e4f129808a08f14d0741d10c4d6be4e0c8b358ef2f4ff',
      'e1-tab.golden.png': '9957bd64609aca62a6442b04833102924fdcfbe3969ff3106b4de8ac10f3dc3d',
    });

    for (const fileName of ['e1-flows.json', 'e2-flows.json', 'e1-tab.golden.png'] as const) {
      expect(readAudit20260610FixtureBytes(fileName).byteLength).toBeGreaterThan(0);
    }
  });

  it('loads corpus flow fixtures through FlowsJsonSchema', () => {
    expect(parseFlows('e1-flows.json')).toHaveLength(28);
    expect(parseFlows('e2-flows.json')).toHaveLength(13);
  });

  it('hard-fails on sha256 mismatch', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'flow-otter-eval3-'));
    try {
      copyFileSync(FIXTURE_MANIFEST_PATH, path.join(dir, 'sha256-manifest.json'));
      const fixturePath = audit20260610FixturePath('e1-flows.json');
      writeFileSync(path.join(dir, 'e1-flows.json'), `${readFileSync(fixturePath, 'utf8')}\n`);

      expect(() => readAudit20260610FixtureBytes('e1-flows.json', { fixtureDir: dir })).toThrow(
        /sha256 mismatch/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Leg-B zero-coordinate spec assertion', () => {
  it('rejects non-junction node position keys while allowing junction x/y waypoint semantics', () => {
    const files = walkFiles(SPECS_DIR);
    expect(files.length).toBeGreaterThan(0);

    for (const filePath of files) {
      const spec = parseStructuredSpec(filePath);
      if (spec !== undefined) assertNoNonJunctionNodePositionKeys(spec);
    }

    expect(() =>
      assertNoNonJunctionNodePositionKeys({
        nodes: [{ id: 'n1', type: 'function', x: 10 }],
      }),
    ).toThrow(/disallowed x key/u);
    expect(() =>
      assertNoNonJunctionNodePositionKeys({
        nodes: [{ id: 'j1', type: 'junction', x: 10, y: 20 }],
      }),
    ).not.toThrow();
    expect(() =>
      assertNoNonJunctionNodePositionKeys({
        nodes: [{ id: 'j1', type: 'junction', position: { x: 10, y: 20 } }],
      }),
    ).toThrow(/disallowed position key/u);
  });
});

describe('frozen EVAL-3 thresholds', () => {
  it('mirrors layout_lint weighted rule schema and freezes the first charter run', () => {
    const thresholds = readJson<Thresholds>(THRESHOLDS_PATH);

    expect(thresholds.layout_lint_contract.score_range).toEqual([0, 1]);
    expect(thresholds.layout_lint_contract.rules).toEqual(FROZEN_RULES);

    const entriesById = new Map(
      thresholds.first_benchmark_run.entries.map((entry) => [entry.id, entry]),
    );
    expect([...entriesById.keys()].sort()).toEqual(['audit-2026-06-10-e1', 'audit-2026-06-10-e2']);

    const e1 = entriesById.get('audit-2026-06-10-e1')!;
    expect(e1.source_sha256).toBe(
      'ba8ac47e906a7c0a34ee31c1a18a86787a0780456dfbb677870593bb313111f1',
    );
    expect(e1.overall).toBe(0.9333333333333333);
    expect(normalizedRules(e1.rules)).toEqual(reportRules(parseFlows('e1-flows.json')));

    const e2 = entriesById.get('audit-2026-06-10-e2')!;
    expect(e2.source_sha256).toBe(
      '21dce7e6ad41d9e3777e4f129808a08f14d0741d10c4d6be4e0c8b358ef2f4ff',
    );
    expect(e2.overall).toBe(0.6083916083916083);
    expect(normalizedRules(e2.rules)).toEqual(reportRules(parseFlows('e2-flows.json')));

    for (const entry of thresholds.first_benchmark_run.entries) {
      expect(entry.rules.map((r) => ({ rule: r.rule, weight: r.weight }))).toEqual(FROZEN_RULES);
      for (const rule of entry.rules) {
        expect(rule.score).toBeGreaterThanOrEqual(0);
        expect(rule.score).toBeLessThanOrEqual(1);
        expect(Number.isInteger(rule.offender_count)).toBe(true);
        expect(rule.offender_count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('pre-registers the ratified D-7 R4 separation values', () => {
    const thresholds = readJson<Thresholds>(THRESHOLDS_PATH);

    expect(thresholds.r4_separation.score_ordering_margin).toBe(0.15);
    expect(thresholds.r4_separation.spag_raw['layout-backward-wires'].offender_count).toBe(8);
    expect(thresholds.r4_separation.spag_raw['layout-wire-crossings'].minimum_offender_count).toBe(
      1,
    );
    expect(
      thresholds.r4_separation.engine_outputs['layout-group-overlap'].minimum_offender_count,
    ).toBe(2);
    expect(thresholds.r4_separation.engine_outputs['comment-pile'].offender_count).toBe(6);
    expect(thresholds.r4_separation.engine_outputs['off-canvas-groups'].offender_count).toBe(2);
    expect(thresholds.r4_separation.engine_outputs['layout-error-lane-below'].fires).toBe(true);
    expect(thresholds.r4_separation.e1_agent.occlusion).toEqual({
      maximum_offender_count: 3,
      maximum_severity: 'warning',
    });
    expect(thresholds.r4_separation.e1_agent.f11_true_positives_expected).toBe(true);
  });
});

describe('EVAL-3 content hash pins', () => {
  it('records thresholds.json hash in PROTOCOL.md and both hashes in DESIGN.md', () => {
    const protocol = readFileSync(PROTOCOL_PATH, 'utf8');
    const design = readFileSync(DESIGN_PATH, 'utf8');
    const thresholdsHash = sha256File(THRESHOLDS_PATH);
    const protocolHash = sha256File(PROTOCOL_PATH);

    const protocolThresholdHash = protocol.match(
      /thresholds\.json` sha256: `([0-9a-f]{64})`/u,
    )?.[1];
    expect(protocolThresholdHash).toBe(thresholdsHash);

    const designThresholdHash = design.match(/thresholds\.json` sha256 `([0-9a-f]{64})`/u)?.[1];
    const designProtocolHash = design.match(/PROTOCOL\.md` sha256 `([0-9a-f]{64})`/u)?.[1];
    expect(designThresholdHash).toBe(thresholdsHash);
    expect(designProtocolHash).toBe(protocolHash);
    expect(protocol).toMatch(/PROTOCOL\.md` cannot record\s+its own hash/u);
  });
});
