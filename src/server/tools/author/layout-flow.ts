import { z } from 'zod';

import {
  isComment,
  isGroup,
  isJunction,
  isRegularNode,
  isTab,
  type FlowsJson,
} from '../../../shared/flows-json.js';
import { layoutFlowsWithDagre, layoutTabs } from '../../../toolkit/layout/index.js';
import {
  dimensionsForJunction,
  dimensionsForNode,
  type LayoutDiagnostic,
} from '../../../toolkit/layout/apply-positions.js';
import { DEFAULT_GRID } from '../../../toolkit/layout/grid.js';
import { editorGeometryProvider } from '../../../toolkit/render/metrics.js';
import { LANE_NAMES, type Lane } from '../../../toolkit/lanes.js';
import type {
  AuthoringSpec,
  CommentSpec,
  GroupSpec,
  JunctionSpec,
  NodeSpec,
  Position,
  TabSpec,
} from '../../../toolkit/authoring/types.js';
import { ValidationFailedError, type Tool } from '../_tool.js';

import {
  resolveTabId,
  runStagedAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const LaneSchema = z.enum(LANE_NAMES);

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    scope: z.literal('tab').optional(),
    lane_hints: z.record(LaneSchema).optional(),
    section_order: z.array(z.string().min(1)).optional(),
    pinned: z.array(z.string().min(1)).optional(),
    engine: z.enum(['two_level', 'legacy_dagre']).optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const DiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  rule: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
  tabId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

const DiffSummarySchema = z.object({
  nodes_added: z.number(),
  nodes_removed: z.number(),
  nodes_modified: z.number(),
  wires_added: z.number(),
  wires_removed: z.number(),
});

const LayoutReportSchema = z.object({
  tab_id: z.string(),
  engine: z.enum(['two_level', 'legacy_dagre']),
  diagnostics: z.array(DiagnosticSchema),
  applied_lane_hints: z.record(LaneSchema),
  section_order: z.array(z.string()),
  pinned: z.array(z.string()),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  staged_hash: z.string(),
  based_on_snapshot_hash: z.string(),
  based_on_rev: z.string().nullable(),
  diff_summary: DiffSummarySchema,
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
  layout_report: LayoutReportSchema,
  dry_run: z.boolean(),
  staged: z.boolean(),
});
type Output = z.infer<typeof OutputSchema>;

interface ResolvedLayoutInput {
  readonly tabId: string;
  readonly laneHints: ReadonlyMap<string, Lane>;
  readonly sectionOrder: readonly string[];
  readonly pinned: ReadonlySet<string>;
}

interface UnknownReference {
  readonly field: string;
  readonly value: string;
}

interface KeyIndex {
  readonly laneHintKeys: ReadonlySet<string>;
  readonly sectionOrderKeys: ReadonlySet<string>;
  readonly pinnedKeys: ReadonlySet<string>;
  readonly nodeRedIdToKey: ReadonlyMap<string, string>;
}

interface Rect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

const PINNED_VERTICAL_GAP = DEFAULT_GRID * 2;

export const layoutFlowTool: Tool<Input, Output> = {
  name: 'layout_flow',
  description: withStagedAuthorToolDescription(
    'Opt-in staged auto-layout for one tab. Computes deterministic geometry with the two-level layout engine by default, or the legacy dagre fallback when requested. Input keys are validated loudly; lane_hints and section_order affect only this layout run and are not persisted. dry_run validates and reports the diff without writing the staging slot. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['tab_id'],
    properties: {
      tab_id: {
        type: 'string',
        minLength: 1,
        description: 'Tab to lay out, addressed by Node-RED tab id or _authoringKey.',
      },
      scope: {
        type: 'string',
        enum: ['tab'],
        description: 'Currently tab-level only; sub-tab/key scopes are intentionally not exposed.',
      },
      lane_hints: {
        type: 'object',
        additionalProperties: { type: 'string', enum: [...LANE_NAMES] },
        description:
          'Per-run lane hints keyed by node, junction, or group authoring key/Node-RED id. Not persisted into flows.json.',
      },
      section_order: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        description:
          'Optional order of section ids or group keys for this layout run. Unknown keys are rejected.',
      },
      pinned: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        description:
          'Object keys/Node-RED ids whose geometry is restored verbatim; laid content is translated below the pinned bounding box.',
      },
      engine: {
        type: 'string',
        enum: ['two_level', 'legacy_dagre'],
        description: "Layout engine. Defaults to 'two_level'.",
      },
      dry_run: {
        type: 'boolean',
        description: 'Validate/diff and return the layout report without writing the staging slot.',
      },
    },
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<
      {
        tabId: string;
        engine: 'two_level' | 'legacy_dagre';
        layoutDiagnostics: readonly LayoutDiagnostic[];
        laneHints: ReadonlyMap<string, Lane>;
        sectionOrder: readonly string[];
        pinned: readonly string[];
      },
      Output
    >(
      ctx,
      { toolName: 'layout_flow', dryRun: input.dry_run === true },
      async (priorSpec, priorFlows) => {
        const engine = input.engine ?? 'two_level';
        const resolved = resolveLayoutInput(priorSpec, priorFlows, input);
        if (
          engine === 'legacy_dagre' &&
          (resolved.laneHints.size > 0 || resolved.sectionOrder.length > 0)
        ) {
          throw unsupportedLegacyDagreOptions();
        }

        const layoutDiagnostics: LayoutDiagnostic[] = [];
        const nextSpec =
          engine === 'two_level'
            ? await layoutTabs(priorSpec, {
                tabIds: [resolved.tabId],
                laneHints: resolved.laneHints,
                sectionOrder: resolved.sectionOrder,
                onDiagnostic: (diagnostic) => layoutDiagnostics.push(diagnostic),
              })
            : layoutTabWithLegacyDagre(priorSpec, resolved.tabId, layoutDiagnostics);
        const pinnedSpec = applyPinnedLayout(nextSpec, priorSpec, resolved.tabId, resolved.pinned);

        return {
          nextSpec: pinnedSpec,
          extras: {
            tabId: resolved.tabId,
            engine,
            layoutDiagnostics,
            laneHints: resolved.laneHints,
            sectionOrder: resolved.sectionOrder,
            pinned: [...resolved.pinned].sort(compareString),
          },
        };
      },
      (base, extras) => ({
        ok: base.ok,
        staged_hash: base.staged_hash,
        based_on_snapshot_hash: base.based_on_snapshot_hash,
        based_on_rev: base.based_on_rev,
        diff_summary: base.diff_summary,
        diagnostics: [...base.diagnostics],
        render: base.render,
        layout_report: {
          tab_id: extras.tabId,
          engine: extras.engine,
          diagnostics: extras.layoutDiagnostics.map((d) => ({
            severity: d.severity,
            rule: d.rule,
            message: d.message,
            ...(d.nodeId !== undefined ? { nodeId: d.nodeId } : {}),
            ...(d.tabId !== undefined ? { tabId: d.tabId } : {}),
            ...(d.context !== undefined ? { context: d.context } : {}),
          })),
          applied_lane_hints: laneHintRecord(extras.laneHints),
          section_order: [...extras.sectionOrder],
          pinned: [...extras.pinned],
        },
        dry_run: input.dry_run === true,
        staged: input.dry_run !== true,
      }),
    ),
};

function layoutTabWithLegacyDagre(
  priorSpec: AuthoringSpec,
  tabId: string,
  diagnostics: LayoutDiagnostic[],
): AuthoringSpec {
  const tab = priorSpec.tabs.find((candidate) => candidate.id === tabId);
  if (tab === undefined) {
    throw new ValidationFailedError(`Tab '${tabId}' not found in current flows.`, []);
  }
  const laidSingle = layoutFlowsWithDagre(
    { ...priorSpec, tabs: [tab] },
    { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
  );
  const laidTab = laidSingle.tabs[0] ?? tab;
  return {
    ...priorSpec,
    tabs: priorSpec.tabs.map((candidate) => (candidate.id === tabId ? laidTab : candidate)),
  };
}

function resolveLayoutInput(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  input: Input,
): ResolvedLayoutInput {
  const tabId = resolveTabId(priorFlows, input.tab_id);
  const unknown: UnknownReference[] = [];
  if (tabId === undefined) {
    unknown.push({ field: 'tab_id', value: input.tab_id });
    for (const key of Object.keys(input.lane_hints ?? {})) {
      unknown.push({ field: 'lane_hints', value: key });
    }
    for (const key of input.section_order ?? [])
      unknown.push({ field: 'section_order', value: key });
    for (const key of input.pinned ?? []) unknown.push({ field: 'pinned', value: key });
    throw unknownReferencesError(unknown);
  }

  const tab = spec.tabs.find((candidate) => candidate.id === tabId);
  if (tab === undefined) {
    unknown.push({ field: 'tab_id', value: input.tab_id });
    throw unknownReferencesError(unknown);
  }

  const index = buildKeyIndex(tab, priorFlows, tabId);
  const laneHints = new Map<string, Lane>();
  for (const [rawKey, lane] of Object.entries(input.lane_hints ?? {})) {
    const resolved = resolveObjectKey(rawKey, index.laneHintKeys, index.nodeRedIdToKey);
    if (resolved === undefined) unknown.push({ field: 'lane_hints', value: rawKey });
    else laneHints.set(resolved, lane);
  }

  const sectionOrder: string[] = [];
  for (const rawKey of input.section_order ?? []) {
    const resolved = resolveObjectKey(rawKey, index.sectionOrderKeys, index.nodeRedIdToKey);
    if (resolved === undefined) {
      unknown.push({ field: 'section_order', value: rawKey });
    } else if (!sectionOrder.includes(resolved)) {
      sectionOrder.push(resolved);
    }
  }

  const pinned = new Set<string>();
  for (const rawKey of input.pinned ?? []) {
    const resolved = resolveObjectKey(rawKey, index.pinnedKeys, index.nodeRedIdToKey);
    if (resolved === undefined) {
      unknown.push({ field: 'pinned', value: rawKey });
    } else {
      pinned.add(resolved);
    }
  }

  if (unknown.length > 0) throw unknownReferencesError(unknown);
  return { tabId, laneHints, sectionOrder, pinned };
}

function buildKeyIndex(tab: TabSpec, priorFlows: FlowsJson, tabId: string): KeyIndex {
  const nodeKeys = new Set(tab.nodes.map((node) => node.key));
  const junctionKeys = new Set((tab.junctions ?? []).map((junction) => junction.key));
  const groupKeys = new Set(tab.groups.map((group) => group.key));
  const commentKeys = new Set(tab.comments.map((comment) => comment.key));
  const participantKeys = new Set([...nodeKeys, ...junctionKeys]);
  const laneHintKeys = new Set([...participantKeys, ...groupKeys]);
  const sectionOrderKeys = new Set([...participantKeys, ...groupKeys]);
  const pinnedKeys = new Set([...participantKeys, ...groupKeys, ...commentKeys]);
  const nodeRedIdToKey = nodeRedObjectIdToKey(priorFlows, tabId);
  return { laneHintKeys, sectionOrderKeys, pinnedKeys, nodeRedIdToKey };
}

function nodeRedObjectIdToKey(
  priorFlows: FlowsJson,
  authoringTabId: string,
): ReadonlyMap<string, string> {
  const tabNodeRedId = nodeRedTabIdForAuthoringTab(priorFlows, authoringTabId);
  const out = new Map<string, string>();
  if (tabNodeRedId === undefined) return out;
  for (const node of priorFlows) {
    if ((node as { z?: unknown }).z !== tabNodeRedId) continue;
    if (!isRegularNode(node) && !isJunction(node) && !isGroup(node) && !isComment(node)) continue;
    out.set(node.id, authoringKeyForFlowNode(node));
  }
  return out;
}

function nodeRedTabIdForAuthoringTab(
  priorFlows: FlowsJson,
  authoringTabId: string,
): string | undefined {
  for (const node of priorFlows) {
    if (!isTab(node)) continue;
    if (authoringKeyForFlowNode(node) === authoringTabId) return node.id;
  }
  return undefined;
}

function authoringKeyForFlowNode(node: FlowsJson[number]): string {
  const ext = (node as Record<string, unknown>)['_authoringKey'];
  return typeof ext === 'string' ? ext : node.id;
}

function resolveObjectKey(
  rawKey: string,
  allowedKeys: ReadonlySet<string>,
  nodeRedIdToKey: ReadonlyMap<string, string>,
): string | undefined {
  if (allowedKeys.has(rawKey)) return rawKey;
  const resolved = nodeRedIdToKey.get(rawKey);
  if (resolved !== undefined && allowedKeys.has(resolved)) return resolved;
  return undefined;
}

function unknownReferencesError(unknown: readonly UnknownReference[]): ValidationFailedError {
  const groups = new Map<string, string[]>();
  for (const ref of unknown) {
    const values = groups.get(ref.field);
    if (values === undefined) groups.set(ref.field, [ref.value]);
    else values.push(ref.value);
  }
  const detail = [...groups]
    .map(([field, values]) => `${field}: ${[...new Set(values)].join(', ')}`)
    .join('; ');
  return new ValidationFailedError(
    `layout_flow could not resolve these tab/key reference(s): ${detail}.`,
    unknown.map((ref) => ({
      severity: 'error',
      rule: 'layout/unknown-reference',
      message: `${ref.field} reference '${ref.value}' was not found.`,
      context: { field: ref.field, value: ref.value },
    })),
  );
}

function unsupportedLegacyDagreOptions(): ValidationFailedError {
  return new ValidationFailedError(
    'layout_flow engine legacy_dagre does not support lane_hints or section_order; use engine two_level or omit those options.',
    [
      {
        severity: 'error',
        rule: 'layout/unsupported-option',
        message: 'legacy_dagre ignores lane_hints and section_order, so the call is refused.',
      },
    ],
  );
}

function applyPinnedLayout(
  laidSpec: AuthoringSpec,
  priorSpec: AuthoringSpec,
  tabId: string,
  pinned: ReadonlySet<string>,
): AuthoringSpec {
  if (pinned.size === 0) return laidSpec;
  const priorTab = priorSpec.tabs.find((candidate) => candidate.id === tabId);
  const laidTab = laidSpec.tabs.find((candidate) => candidate.id === tabId);
  if (priorTab === undefined || laidTab === undefined) return laidSpec;
  const pinnedRect = tabRect(priorTab, pinned, true);
  const laidRect = tabRect(laidTab, pinned, false);
  const dy =
    pinnedRect !== undefined && laidRect !== undefined
      ? Math.max(0, snapUp(pinnedRect.y2 + PINNED_VERTICAL_GAP - laidRect.y1, DEFAULT_GRID))
      : 0;
  const nextTab = restorePinnedAndTranslate(priorTab, laidTab, pinned, dy);
  return {
    ...laidSpec,
    tabs: laidSpec.tabs.map((candidate) => (candidate.id === tabId ? nextTab : candidate)),
  };
}

function restorePinnedAndTranslate(
  priorTab: TabSpec,
  laidTab: TabSpec,
  pinned: ReadonlySet<string>,
  dy: number,
): TabSpec {
  const priorNodes = new Map(priorTab.nodes.map((node) => [node.key, node]));
  const priorJunctions = new Map(
    (priorTab.junctions ?? []).map((junction) => [junction.key, junction]),
  );
  const priorGroups = new Map(priorTab.groups.map((group) => [group.key, group]));
  const priorComments = new Map(priorTab.comments.map((comment) => [comment.key, comment]));
  const nodes = laidTab.nodes.map((node) =>
    pinned.has(node.key) ? (priorNodes.get(node.key) ?? node) : translateNode(node, dy),
  );
  const junctions = laidTab.junctions?.map((junction) =>
    pinned.has(junction.key)
      ? (priorJunctions.get(junction.key) ?? junction)
      : translateJunction(junction, dy),
  );
  const groups = laidTab.groups.map((group) =>
    pinned.has(group.key) ? (priorGroups.get(group.key) ?? group) : translateGroup(group, dy),
  );
  const comments = laidTab.comments.map((comment) =>
    pinned.has(comment.key)
      ? (priorComments.get(comment.key) ?? comment)
      : translateComment(comment, dy),
  );
  return {
    ...laidTab,
    nodes,
    groups,
    comments,
    ...(junctions !== undefined ? { junctions } : {}),
  };
}

function tabRect(
  tab: TabSpec,
  pinned: ReadonlySet<string>,
  includePinned: boolean,
): Rect | undefined {
  let rect: Rect | undefined;
  const shouldInclude = (key: string): boolean => pinned.has(key) === includePinned;
  for (const node of tab.nodes) if (shouldInclude(node.key)) rect = unionRect(rect, nodeRect(node));
  for (const junction of tab.junctions ?? []) {
    if (shouldInclude(junction.key)) rect = unionRect(rect, junctionRect(junction));
  }
  for (const group of tab.groups) {
    if (shouldInclude(group.key)) rect = unionRect(rect, groupRect(group));
  }
  for (const comment of tab.comments) {
    if (shouldInclude(comment.key)) rect = unionRect(rect, commentRect(comment));
  }
  return rect;
}

function nodeRect(node: NodeSpec): Rect {
  return centeredRect(node.position, dimensionsForNode(node));
}

function junctionRect(junction: JunctionSpec): Rect {
  return centeredRect(junction.position, dimensionsForJunction());
}

function groupRect(group: GroupSpec): Rect | undefined {
  if (group.position === undefined) return undefined;
  if (group.size === undefined) return centeredRect(group.position, { w: 0, h: 0 });
  return {
    x1: group.position.x,
    y1: group.position.y,
    x2: group.position.x + group.size.w,
    y2: group.position.y + group.size.h,
  };
}

function commentRect(comment: CommentSpec): Rect {
  const dimensions =
    comment.size ??
    editorGeometryProvider.nodeDimensionsFor(comment.text, { inputs: 0, outputs: 0 });
  return centeredRect(comment.position, dimensions);
}

function centeredRect(
  position: Position,
  dimensions: { readonly w: number; readonly h: number },
): Rect {
  return {
    x1: position.x - dimensions.w / 2,
    y1: position.y - dimensions.h / 2,
    x2: position.x + dimensions.w / 2,
    y2: position.y + dimensions.h / 2,
  };
}

function unionRect(a: Rect | undefined, b: Rect | undefined): Rect | undefined {
  if (b === undefined) return a;
  if (a === undefined) return b;
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

function snapUp(value: number, grid: number): number {
  return Math.ceil(value / grid) * grid;
}

function translatePosition(position: Position, dy: number): Position {
  return dy === 0 ? position : { x: position.x, y: position.y + dy };
}

function translateNode(node: NodeSpec, dy: number): NodeSpec {
  return dy === 0 ? node : { ...node, position: translatePosition(node.position, dy) };
}

function translateJunction(junction: JunctionSpec, dy: number): JunctionSpec {
  return dy === 0 ? junction : { ...junction, position: translatePosition(junction.position, dy) };
}

function translateGroup(group: GroupSpec, dy: number): GroupSpec {
  return dy === 0 || group.position === undefined
    ? group
    : { ...group, position: translatePosition(group.position, dy) };
}

function translateComment(comment: CommentSpec, dy: number): CommentSpec {
  return dy === 0 ? comment : { ...comment, position: translatePosition(comment.position, dy) };
}

function laneHintRecord(hints: ReadonlyMap<string, Lane>): Record<string, Lane> {
  const out: Record<string, Lane> = {};
  for (const [key, lane] of [...hints].sort(([a], [b]) => compareString(a, b))) out[key] = lane;
  return out;
}

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
