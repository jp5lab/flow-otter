/**
 * Node-RED version → capability matrix. Used to gate FlowOtter behavior on
 * features that are only available in specific Node-RED versions.
 *
 * The matrix is intentionally minimal: pre-3.0 is unsupported by FlowOtter,
 * so only the 3.x → 5.x feature deltas need explicit gating. New entries
 * follow the same pattern: feature name → SemVer range that satisfies it.
 *
 * The parser/comparator is a small inline implementation (no external
 * dependency) tuned to Node-RED's release format: MAJOR.MINOR.PATCH with
 * optional `-beta.N` / `-rc.N` / `-alpha.N` prerelease tags.
 */

export type Capability =
  /** Group nesting (drag groups into groups). Added in Node-RED 3.1. */
  | 'groupNesting'
  /** Junction nodes (visual wire-routing passthrough). Added in 3.0. */
  | 'junctions'
  /** /flows/state runtime-state API. Always present since 2.x, but gated on
   *  `runtimeState.enabled = true` in settings.js. */
  | 'runtimeStateApi'
  /** Link Call node + return-mode link out. Added in 3.1. */
  | 'linkCallNode'
  /** Function node `node.linkcall(target, msg, opts)` runtime API.
   *  Added in 5.0 (PR #5494, first shipped in 5.0.0-beta.6). */
  | 'functionLinkCall'
  /** Per-instance config-node selection inside subflow instances.
   *  Added in 4.0 — major Node-RED 4.0 feature. */
  | 'subflowPerInstanceConfig'
  /** Inject-node ISO 8601 / Date timestamp formats. Added in 4.0. */
  | 'isoTimestampInject'
  /** JSONata 2.0 (vs 1.8). Added in Node-RED 4.0. */
  | 'jsonata2'
  /** Function-node external modules with `node:` prefix imports.
   *  Added in 4.1. */
  | 'functionNodePrefixModules'
  /** `functionGlobalContext.functionTimeout` / `globalFunctionTimeout`.
   *  Added in 4.1. */
  | 'globalFunctionTimeout'
  /** Default `httpAdminCors` rules are present. REMOVED in 5.0 (PR #5652,
   *  first shipped in 5.0.0-beta.6) — cross-origin admin clients must
   *  configure CORS explicitly thereafter. */
  | 'adminCorsDefault'
  /** Delay node `pauseType: "burst"` mode (PR #5391, 5.0.0-beta.2). */
  | 'delayBurstMode'
  /** tls-config PKCS#12 bundles: `certType:"pfx"`, `p12`/`p12name` fields +
   *  `p12data` credential (PR #4907, in from the first 5.0 beta). */
  | 'tlsPfx'
  /** tls-config cert/key/CA from env vars: `certType:"env"`,
   *  `certEnv`/`keyEnv`/`caEnv` (PR #5376, 5.0.0-beta.2). */
  | 'tlsEnvVars'
  /** Credentials file created alongside an out-of-userDir flows file
   *  (PR #4951, 5.0.0-beta.3). Affects file-mode credential lookup. */
  | 'credsAlongsideFlows'
  /** OAuth/strategy logins use exchange codes: `POST /auth/token {code}`
   *  endpoint exists (PR #5657, 5.0.0-beta.6). Password grant unchanged. */
  | 'oauthCodeExchange'
  /** http-request honors tls-config `servername` for SNI (got 14,
   *  PR #5667, 5.0.0-beta.6). */
  | 'httpRequestSni'
  /** ESM node modules installable/loadable (PR #4355, 5.0.0 GA only —
   *  merged after beta.6). */
  | 'esmNodeModules'
  /** settings.js `nodeDefaults` per-type editor-default overrides, echoed
   *  in GET /settings (PR #5591, shipped in 4.1.9 — NOT a 5.0 feature). */
  | 'nodeDefaultsOverride'
  /** GitHub-style markdown alerts ([!NOTE] etc.) render in node/flow info
   *  (PR #5733; gate at GA to be safe). */
  | 'markdownGhAlerts';

interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Empty string if no prerelease tag, else e.g. "beta.6". */
  readonly prerelease: string;
}

/**
 * Map of feature → satisfying SemVer range. Ranges are limited to the small
 * grammar this module supports: `>=X.Y.Z`, `<X.Y.Z`, or `>=X.Y.Z-0`.
 */
const REQUIREMENTS: Record<Capability, string> = {
  groupNesting: '>=3.1.0',
  junctions: '>=3.0.0',
  runtimeStateApi: '>=2.0.0',
  linkCallNode: '>=3.1.0',
  // PR #5494 merged 2026-04-30 and first shipped in 5.0.0-beta.6;
  // betas 0-5 do NOT have node.linkcall.
  functionLinkCall: '>=5.0.0-beta.6',
  subflowPerInstanceConfig: '>=4.0.0',
  isoTimestampInject: '>=4.0.0',
  jsonata2: '>=4.0.0',
  functionNodePrefixModules: '>=4.1.0',
  globalFunctionTimeout: '>=4.1.0',
  // The CORS-default removal (PR #5652) first shipped in 5.0.0-beta.6 —
  // betas 0-5 still applied the default rules.
  adminCorsDefault: '<5.0.0-beta.6',
  delayBurstMode: '>=5.0.0-beta.2',
  tlsPfx: '>=5.0.0-0',
  tlsEnvVars: '>=5.0.0-beta.2',
  credsAlongsideFlows: '>=5.0.0-beta.3',
  oauthCodeExchange: '>=5.0.0-beta.6',
  httpRequestSni: '>=5.0.0-beta.6',
  // Merged after beta.6 — GA only. The comparator's prerelease precedence
  // makes 5.0.0-beta.N NOT satisfy >=5.0.0, which is exactly right here.
  esmNodeModules: '>=5.0.0',
  // Shipped in 4.1.9 (PR #5591), not 5.0.
  nodeDefaultsOverride: '>=4.1.9',
  markdownGhAlerts: '>=5.0.0',
};

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parse a Node-RED-style version string into a SemVer. Returns null on
 * unparseable input. Build metadata (after `+`) is silently dropped.
 */
export function parseSemVer(input: string): SemVer | null {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? '',
  };
}

function comparePrerelease(a: string, b: string): number {
  // SemVer spec: a release version has higher precedence than a prerelease
  // version (e.g., 1.0.0 > 1.0.0-beta).
  if (a === '' && b === '') return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  const ap = a.split('.');
  const bp = b.split('.');
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const aPart = ap[i];
    const bPart = bp[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    const aNum = /^\d+$/.test(aPart) ? Number(aPart) : NaN;
    const bNum = /^\d+$/.test(bPart) ? Number(bPart) : NaN;
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else if (!Number.isNaN(aNum)) {
      // Numeric identifiers always have lower precedence than non-numeric.
      return -1;
    } else if (!Number.isNaN(bNum)) {
      return 1;
    } else if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1;
    }
  }
  return 0;
}

/**
 * SemVer comparison. Returns a negative number if a < b, zero if equal,
 * positive if a > b. Honors prerelease precedence.
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePrerelease(a.prerelease, b.prerelease);
}

const RANGE_RE = /^(>=|<)\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Evaluate whether `version` satisfies the given range. Supports only the
 * `>=` and `<` operators with concrete versions (no `^`, `~`, OR clauses).
 * Returns false if either input fails to parse.
 *
 * Note: the comparator does NOT honor SemVer's "prerelease excluded from
 * stable ranges" rule. `5.0.0-beta.6 satisfies >=5.0.0-0` is true; this is
 * the behavior we want for feature gating since beta.6 ships the feature.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseSemVer(version);
  if (!v) return false;
  const m = RANGE_RE.exec(range.trim());
  if (!m) return false;
  const op = m[1]!;
  const bound = parseSemVer(m[2]!);
  if (!bound) return false;
  const cmp = compareSemVer(v, bound);
  if (op === '>=') return cmp >= 0;
  if (op === '<') return cmp < 0;
  return false;
}

/**
 * For a detected Node-RED version, return a flat map of every capability
 * → boolean. The agent reads this to decide whether to use version-gated
 * features.
 */
export function resolveCapabilities(version: string): Record<Capability, boolean> {
  const out = {} as Record<Capability, boolean>;
  for (const cap of Object.keys(REQUIREMENTS) as Capability[]) {
    out[cap] = satisfiesRange(version, REQUIREMENTS[cap]);
  }
  return out;
}

/**
 * Detect whether a Node-RED version is a pre-release. Used to surface a
 * BETA banner in health_check.
 */
export function isPrerelease(version: string): boolean {
  const v = parseSemVer(version);
  return v !== null && v.prerelease.length > 0;
}

/**
 * Capability-version requirement (exported for tests + docs).
 */
export function requirementFor(cap: Capability): string {
  return REQUIREMENTS[cap];
}

export function allCapabilities(): readonly Capability[] {
  return Object.keys(REQUIREMENTS) as Capability[];
}

/**
 * Cached runtime information about the connected Node-RED instance.
 * Populated lazily by getOrProbeRuntimeInfo() (server/runtime-info.ts).
 */
export interface RuntimeInfo {
  readonly name: 'node-red';
  readonly version: string;
  readonly is_prerelease: boolean;
  readonly node_js_version?: string;
  readonly detected_at: string;
  readonly capabilities: Record<Capability, boolean>;
}
