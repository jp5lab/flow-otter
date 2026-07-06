import { z } from 'zod';

import type { FlowsJson } from '../../../shared/flows-json.js';
import { compile } from '../../../toolkit/authoring/compile.js';
import { decompile } from '../../../toolkit/authoring/decompile.js';
import type {
  AuthoringSpec,
  CommentSpec,
  ConfigNodeSpec,
  ConnectionSpec,
  GroupSpec,
  JunctionSpec,
  NodeSpec,
  Position,
  SubflowDefSpec,
  TabEnvEntry,
  TabSpec,
} from '../../../toolkit/authoring/types.js';
import { LANE_NAMES, type Lane } from '../../../toolkit/lanes.js';
import {
  type LayoutDiagnostic,
  dimensionsForNode,
  dimensionsForJunction,
} from '../../../toolkit/layout/apply-positions.js';
import { DEFAULT_GRID } from '../../../toolkit/layout/grid.js';
import { layoutTabs } from '../../../toolkit/layout/index.js';
import { editorGeometryProvider } from '../../../toolkit/render/metrics.js';
import { ValidationFailedError } from '../_tool.js';

export const COMPUTED_PLACEMENT_MESSAGE =
  'FlowOtter computes placement for stage_spec/validate_spec. Remove raw geometry fields (x, y, position, w, h) and use layout_hints.lane_hints or layout_hints.section_order instead.';

const GEOMETRY_FIELDS = ['x', 'y', 'position', 'w', 'h'] as const;

const LaneSchema = z.enum(LANE_NAMES);

const ForbiddenGeometryFieldSchema = z
  .unknown()
  .optional()
  .superRefine((value, ctx) => {
    if (value !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: COMPUTED_PLACEMENT_MESSAGE });
    }
  });

const PassthroughSchema = z.record(z.unknown()).superRefine((value, ctx) => {
  for (const field of GEOMETRY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: COMPUTED_PLACEMENT_MESSAGE,
      });
    }
  }
});

const LoosePassthroughSchema = z.record(z.unknown());

const WidgetAnchorSchema = z
  .object({
    kind: z.enum(['group', 'page', 'ui']),
    refKey: z.string().min(1),
  })
  .strict();

const NodeSchema = z
  .object({
    key: z.string().min(1),
    type: z.string().min(1),
    label: z.string().optional(),
    info: z.string().optional(),
    groupKey: z.string().min(1).optional(),
    widgetAnchor: WidgetAnchorSchema.optional(),
    passthrough: PassthroughSchema.optional(),
    x: ForbiddenGeometryFieldSchema,
    y: ForbiddenGeometryFieldSchema,
    position: ForbiddenGeometryFieldSchema,
    w: ForbiddenGeometryFieldSchema,
    h: ForbiddenGeometryFieldSchema,
  })
  .strict();

const GroupSchema = z
  .object({
    key: z.string().min(1),
    name: z.string(),
    nodeKeys: z.array(z.string().min(1)),
    parentKey: z.string().min(1).optional(),
    info: z.string().optional(),
    style: z.record(z.unknown()).optional(),
    passthrough: PassthroughSchema.optional(),
    x: ForbiddenGeometryFieldSchema,
    y: ForbiddenGeometryFieldSchema,
    position: ForbiddenGeometryFieldSchema,
    w: ForbiddenGeometryFieldSchema,
    h: ForbiddenGeometryFieldSchema,
  })
  .strict();

const CommentSchema = z
  .object({
    key: z.string().min(1),
    text: z.string(),
    info: z.string().optional(),
    groupKey: z.string().min(1).optional(),
    x: ForbiddenGeometryFieldSchema,
    y: ForbiddenGeometryFieldSchema,
    position: ForbiddenGeometryFieldSchema,
    w: ForbiddenGeometryFieldSchema,
    h: ForbiddenGeometryFieldSchema,
  })
  .strict();

const JunctionSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().optional(),
    groupKey: z.string().min(1).optional(),
    disabled: z.boolean().optional(),
    x: ForbiddenGeometryFieldSchema,
    y: ForbiddenGeometryFieldSchema,
    position: ForbiddenGeometryFieldSchema,
    w: ForbiddenGeometryFieldSchema,
    h: ForbiddenGeometryFieldSchema,
  })
  .strict();

const ConnectionSchema = z
  .object({
    fromKey: z.string().min(1),
    outputPort: z.number().int().nonnegative(),
    toKey: z.string().min(1),
  })
  .strict();

const TabEnvEntrySchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(['str', 'num', 'bool', 'json', 'env', 'cred', 'jsonata', 'conf-type']),
    value: z.unknown().optional(),
    ui: z.record(z.unknown()).optional(),
  })
  .strict();

const TabSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    disabled: z.boolean().optional(),
    info: z.string().optional(),
    locked: z.boolean().optional(),
    env: z.array(TabEnvEntrySchema).optional(),
    nodes: z.array(NodeSchema),
    connections: z.array(ConnectionSchema),
    groups: z.array(GroupSchema).optional(),
    comments: z.array(CommentSchema).optional(),
    junctions: z.array(JunctionSchema).optional(),
    passthrough: LoosePassthroughSchema.optional(),
  })
  .strict();

const ConfigNodeSchema = z
  .object({
    key: z.string().min(1),
    type: z.string().min(1),
    label: z.string().optional(),
    passthrough: LoosePassthroughSchema.optional(),
  })
  .strict();

const SubflowDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    info: z.string().optional(),
    env: z.array(TabEnvEntrySchema).optional(),
    nodes: z.array(NodeSchema),
    connections: z.array(ConnectionSchema),
    junctions: z.array(JunctionSchema).optional(),
    passthrough: LoosePassthroughSchema.optional(),
  })
  .strict();

export const SpecSchema = z
  .object({
    tabs: z.array(TabSchema).min(1),
    configNodes: z.array(ConfigNodeSchema).optional(),
    subflowDefs: z.array(SubflowDefSchema).optional(),
  })
  .strict();

export const TabLayoutHintsSchema = z
  .object({
    lane_hints: z.record(LaneSchema).optional(),
    section_order: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const LayoutHintsSchema = TabLayoutHintsSchema.extend({
  per_tab: z.record(TabLayoutHintsSchema).optional(),
}).strict();

export type SpecInput = z.infer<typeof SpecSchema>;
export type LayoutHintsInput = z.infer<typeof LayoutHintsSchema>;

export const DiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  rule: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
  tabId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

export const DiffSummarySchema = z.object({
  nodes_added: z.number(),
  nodes_removed: z.number(),
  nodes_modified: z.number(),
  wires_added: z.number(),
  wires_removed: z.number(),
});

export const LayoutReportSchema = z.object({
  engine: z.literal('two_level'),
  tabs: z.array(
    z.object({
      tab_id: z.string(),
      diagnostics: z.array(DiagnosticSchema),
      applied_lane_hints: z.record(LaneSchema),
      section_order: z.array(z.string()),
      pinned: z.array(z.string()),
    }),
  ),
});

export type LayoutReport = z.infer<typeof LayoutReportSchema>;

interface PreparedSpec {
  readonly spec: AuthoringSpec;
  readonly layoutReport: LayoutReport;
}

interface PreparedTab {
  readonly tab: TabSpec;
  readonly nextTempIndex: number;
}

interface LayoutReportDraft {
  readonly tabId: string;
  readonly diagnostics: LayoutDiagnostic[];
  readonly laneHints: ReadonlyMap<string, Lane>;
  readonly sectionOrder: readonly string[];
  readonly pinned: readonly string[];
}

interface ResolvedTabHints {
  readonly laneHints: ReadonlyMap<string, Lane>;
  readonly sectionOrder: readonly string[];
}

interface UnknownReference {
  readonly field: string;
  readonly value: string;
}

interface Rect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

const TEMP_START_X = DEFAULT_GRID * 6;
const TEMP_START_Y = DEFAULT_GRID * 6;
const TEMP_COLUMNS = 6;
const PINNED_VERTICAL_GAP = DEFAULT_GRID * 2;

export async function prepareSpecAuthoring(
  inputSpec: SpecInput,
  priorSpec: AuthoringSpec,
  priorFlows: FlowsJson,
  hints: LayoutHintsInput | undefined,
): Promise<PreparedSpec> {
  const merged = mergeDeclaredSpec(inputSpec, priorSpec);
  const compiledForIdPreservation = compile(merged, { prior: priorFlows });
  const idPreservedSpec = decompile(compiledForIdPreservation.flows);
  const declaredTabIds = inputSpec.tabs.map((tab) => tab.id);
  const subflowTabIds = inputSpec.subflowDefs?.map((def) => subflowLayoutTabId(def.id)) ?? [];
  const tabIdsToLayout = [...declaredTabIds, ...subflowTabIds];
  const priorLayoutSpec = specWithSubflowLayoutTabs(priorSpec);
  const idPreservedLayoutSpec = specWithSubflowLayoutTabs(idPreservedSpec);
  const reports: LayoutReportDraft[] = [];
  let laidSpec = idPreservedLayoutSpec;

  for (const tabId of tabIdsToLayout) {
    const resolvedHints = resolveHintsForTab(idPreservedLayoutSpec, tabId, declaredTabIds, hints);
    const diagnostics: LayoutDiagnostic[] = [];
    laidSpec = await layoutTabs(laidSpec, {
      tabIds: [tabId],
      laneHints: resolvedHints.laneHints,
      sectionOrder: resolvedHints.sectionOrder,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const pinned = survivingPinnedKeys(priorLayoutSpec, idPreservedLayoutSpec, tabId);
    laidSpec = applyPinnedLayout(laidSpec, priorLayoutSpec, tabId, pinned);
    reports.push({
      tabId,
      diagnostics,
      laneHints: resolvedHints.laneHints,
      sectionOrder: resolvedHints.sectionOrder,
      pinned: [...pinned].sort(compareString),
    });
  }

  return {
    spec: specFromLayoutTabs(laidSpec, idPreservedSpec),
    layoutReport: {
      engine: 'two_level',
      tabs: reports.map((report) => ({
        tab_id: report.tabId,
        diagnostics: report.diagnostics.map((d) => ({
          severity: d.severity,
          rule: d.rule,
          message: d.message,
          ...(d.nodeId !== undefined ? { nodeId: d.nodeId } : {}),
          ...(d.tabId !== undefined ? { tabId: d.tabId } : {}),
          ...(d.context !== undefined ? { context: d.context } : {}),
        })),
        applied_lane_hints: laneHintRecord(report.laneHints),
        section_order: [...report.sectionOrder],
        pinned: [...report.pinned],
      })),
    },
  };
}

function mergeDeclaredSpec(input: SpecInput, priorSpec: AuthoringSpec): AuthoringSpec {
  const declaredTabs = new Map(input.tabs.map((tab) => [tab.id, tab]));
  const tabs: TabSpec[] = [];
  for (const priorTab of priorSpec.tabs) {
    const replacement = declaredTabs.get(priorTab.id);
    if (replacement === undefined) {
      tabs.push(priorTab);
      continue;
    }
    tabs.push(materializeTab(replacement, priorTab));
    declaredTabs.delete(priorTab.id);
  }
  for (const tab of input.tabs) {
    if (declaredTabs.has(tab.id)) tabs.push(materializeTab(tab, undefined));
  }

  const out: AuthoringSpec = {
    tabs,
    ...(input.configNodes !== undefined
      ? { configNodes: input.configNodes.map(materializeConfigNode) }
      : priorSpec.configNodes !== undefined
        ? { configNodes: priorSpec.configNodes }
        : {}),
    ...(input.subflowDefs !== undefined
      ? { subflowDefs: input.subflowDefs.map((def) => materializeSubflowDef(def, priorSpec)) }
      : priorSpec.subflowDefs !== undefined
        ? { subflowDefs: priorSpec.subflowDefs }
        : {}),
  };
  return out;
}

function materializeTab(input: SpecInput['tabs'][number], priorTab: TabSpec | undefined): TabSpec {
  const prepared = prepareTabBody(
    input.nodes,
    input.groups ?? [],
    input.comments ?? [],
    input.junctions ?? [],
    priorTab,
  );
  return {
    id: input.id,
    label: input.label,
    ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
    ...(input.info !== undefined ? { info: input.info } : {}),
    ...(input.locked !== undefined ? { locked: input.locked } : {}),
    ...(input.env !== undefined ? { env: input.env.map(materializeEnvEntry) } : {}),
    nodes: prepared.tab.nodes,
    connections: input.connections.map(materializeConnection),
    groups: prepared.tab.groups,
    comments: prepared.tab.comments,
    ...(prepared.tab.junctions !== undefined ? { junctions: prepared.tab.junctions } : {}),
    ...(input.passthrough !== undefined ? { passthrough: input.passthrough } : {}),
  };
}

function materializeSubflowDef(
  input: NonNullable<SpecInput['subflowDefs']>[number],
  priorSpec: AuthoringSpec,
): SubflowDefSpec {
  const priorDef = priorSpec.subflowDefs?.find((candidate) => candidate.id === input.id);
  const prepared = prepareTabBody(
    input.nodes,
    [],
    [],
    input.junctions ?? [],
    priorDefToTab(priorDef),
  );
  return {
    id: input.id,
    name: input.name,
    ...(input.info !== undefined ? { info: input.info } : {}),
    ...(input.env !== undefined ? { env: input.env.map(materializeEnvEntry) } : {}),
    nodes: prepared.tab.nodes,
    connections: input.connections.map(materializeConnection),
    ...(prepared.tab.junctions !== undefined ? { junctions: prepared.tab.junctions } : {}),
    ...(input.passthrough !== undefined ? { passthrough: input.passthrough } : {}),
  };
}

function prepareTabBody(
  nodes: readonly z.infer<typeof NodeSchema>[],
  groups: readonly z.infer<typeof GroupSchema>[],
  comments: readonly z.infer<typeof CommentSchema>[],
  junctions: readonly z.infer<typeof JunctionSchema>[],
  priorTab: TabSpec | undefined,
): PreparedTab {
  const priorNodes = new Map(priorTab?.nodes.map((node) => [node.key, node]) ?? []);
  const priorJunctions = new Map(
    priorTab?.junctions?.map((junction) => [junction.key, junction]) ?? [],
  );
  const priorComments = new Map(priorTab?.comments.map((comment) => [comment.key, comment]) ?? []);
  let tempIndex = 0;
  const nextPosition = (): Position => tempPosition(tempIndex++);

  const materializedNodes = nodes.map((node) =>
    materializeNode(node, priorNodes.get(node.key)?.position ?? nextPosition()),
  );
  const materializedJunctions = junctions.map((junction) =>
    materializeJunction(junction, priorJunctions.get(junction.key)?.position ?? nextPosition()),
  );
  const materializedComments = comments.map((comment) =>
    materializeComment(comment, priorComments.get(comment.key)?.position ?? nextPosition()),
  );
  return {
    tab: {
      id: priorTab?.id ?? '',
      label: priorTab?.label ?? '',
      nodes: materializedNodes,
      connections: [],
      groups: groups.map(materializeGroup),
      comments: materializedComments,
      ...(materializedJunctions.length > 0 ? { junctions: materializedJunctions } : {}),
    },
    nextTempIndex: tempIndex,
  };
}

function materializeNode(input: z.infer<typeof NodeSchema>, position: Position): NodeSpec {
  return {
    key: input.key,
    type: input.type,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.info !== undefined ? { info: input.info } : {}),
    position,
    ...(input.groupKey !== undefined ? { groupKey: input.groupKey } : {}),
    ...(input.widgetAnchor !== undefined ? { widgetAnchor: input.widgetAnchor } : {}),
    ...(input.passthrough !== undefined ? { passthrough: input.passthrough } : {}),
  };
}

function materializeGroup(input: z.infer<typeof GroupSchema>): GroupSpec {
  return {
    key: input.key,
    name: input.name,
    nodeKeys: [...input.nodeKeys],
    ...(input.parentKey !== undefined ? { parentKey: input.parentKey } : {}),
    ...(input.info !== undefined ? { info: input.info } : {}),
    ...(input.style !== undefined ? { style: input.style } : {}),
    ...(input.passthrough !== undefined ? { passthrough: input.passthrough } : {}),
  };
}

function materializeComment(input: z.infer<typeof CommentSchema>, position: Position): CommentSpec {
  return {
    key: input.key,
    text: input.text,
    position,
    ...(input.info !== undefined ? { info: input.info } : {}),
    ...(input.groupKey !== undefined ? { groupKey: input.groupKey } : {}),
  };
}

function materializeJunction(
  input: z.infer<typeof JunctionSchema>,
  position: Position,
): JunctionSpec {
  return {
    key: input.key,
    position,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.groupKey !== undefined ? { groupKey: input.groupKey } : {}),
    ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
  };
}

function materializeConnection(input: z.infer<typeof ConnectionSchema>): ConnectionSpec {
  return {
    fromKey: input.fromKey,
    outputPort: input.outputPort,
    toKey: input.toKey,
  };
}

function materializeConfigNode(input: z.infer<typeof ConfigNodeSchema>): ConfigNodeSpec {
  return {
    key: input.key,
    type: input.type,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.passthrough !== undefined ? { passthrough: input.passthrough } : {}),
  };
}

function materializeEnvEntry(input: z.infer<typeof TabEnvEntrySchema>): TabEnvEntry {
  return {
    name: input.name,
    type: input.type,
    ...(input.value !== undefined ? { value: input.value } : {}),
    ...(input.ui !== undefined ? { ui: input.ui } : {}),
  };
}

function tempPosition(index: number): Position {
  return {
    x: TEMP_START_X + (index % TEMP_COLUMNS) * DEFAULT_GRID * 8,
    y: TEMP_START_Y + Math.floor(index / TEMP_COLUMNS) * DEFAULT_GRID * 5,
  };
}

function subflowLayoutTabId(id: string): string {
  return `__subflow__:${id}`;
}

function priorDefToTab(def: SubflowDefSpec | undefined): TabSpec | undefined {
  if (def === undefined) return undefined;
  return {
    id: subflowLayoutTabId(def.id),
    label: def.name,
    nodes: def.nodes,
    connections: def.connections,
    groups: [],
    comments: [],
    ...(def.junctions !== undefined ? { junctions: def.junctions } : {}),
  };
}

function specWithSubflowLayoutTabs(spec: AuthoringSpec): AuthoringSpec {
  const subflowTabs =
    spec.subflowDefs?.map(
      (def): TabSpec => ({
        id: subflowLayoutTabId(def.id),
        label: def.name,
        nodes: def.nodes,
        connections: def.connections,
        groups: [],
        comments: [],
        ...(def.junctions !== undefined ? { junctions: def.junctions } : {}),
      }),
    ) ?? [];
  return { ...spec, tabs: [...spec.tabs, ...subflowTabs] };
}

function specFromLayoutTabs(layoutSpec: AuthoringSpec, baseSpec: AuthoringSpec): AuthoringSpec {
  const laidTabs = new Map(layoutSpec.tabs.map((tab) => [tab.id, tab]));
  const tabs = baseSpec.tabs.map((tab) => laidTabs.get(tab.id) ?? tab);
  const subflowDefs = baseSpec.subflowDefs?.map((def): SubflowDefSpec => {
    const laid = laidTabs.get(subflowLayoutTabId(def.id));
    if (laid === undefined) return def;
    return {
      ...def,
      nodes: laid.nodes,
      connections: laid.connections,
      ...(laid.junctions !== undefined ? { junctions: laid.junctions } : {}),
    };
  });
  return {
    ...baseSpec,
    tabs,
    ...(subflowDefs !== undefined ? { subflowDefs } : {}),
  };
}

function resolveHintsForTab(
  spec: AuthoringSpec,
  tabId: string,
  declaredTabIds: readonly string[],
  hints: LayoutHintsInput | undefined,
): ResolvedTabHints {
  const empty = { laneHints: new Map<string, Lane>(), sectionOrder: [] };
  if (hints === undefined) return empty;
  const topLevelHasHints = hints.lane_hints !== undefined || hints.section_order !== undefined;
  if (topLevelHasHints && declaredTabIds.length !== 1) {
    throw new ValidationFailedError(
      'Top-level layout_hints.lane_hints and layout_hints.section_order are only allowed when the spec declares exactly one tab; use layout_hints.per_tab for multi-tab specs.',
      [
        {
          severity: 'error',
          rule: 'stage-spec/layout-hints-ambiguous',
          message:
            'Top-level layout hints would be ambiguous across multiple declared tabs. Move them under layout_hints.per_tab.',
        },
      ],
    );
  }
  const rawHints =
    hints.per_tab?.[tabId] ??
    (topLevelHasHints && declaredTabIds[0] === tabId
      ? { lane_hints: hints.lane_hints, section_order: hints.section_order }
      : undefined);
  if (rawHints === undefined) return empty;

  const tab = spec.tabs.find((candidate) => candidate.id === tabId);
  if (tab === undefined) return empty;
  const unknown: UnknownReference[] = [];
  const laneKeys = new Set([
    ...tab.nodes.map((node) => node.key),
    ...(tab.junctions ?? []).map((junction) => junction.key),
    ...tab.groups.map((group) => group.key),
  ]);
  const sectionKeys = laneKeys;
  const laneHints = new Map<string, Lane>();
  for (const [key, lane] of Object.entries(rawHints.lane_hints ?? {})) {
    if (laneKeys.has(key)) laneHints.set(key, lane);
    else unknown.push({ field: `${tabId}.lane_hints`, value: key });
  }
  const sectionOrder: string[] = [];
  for (const key of rawHints.section_order ?? []) {
    if (sectionKeys.has(key)) {
      if (!sectionOrder.includes(key)) sectionOrder.push(key);
    } else {
      unknown.push({ field: `${tabId}.section_order`, value: key });
    }
  }
  if (unknown.length > 0) throw unknownReferencesError(unknown);
  return { laneHints, sectionOrder };
}

function unknownReferencesError(unknown: readonly UnknownReference[]): ValidationFailedError {
  const detail = unknown.map((ref) => `${ref.field}: ${ref.value}`).join('; ');
  return new ValidationFailedError(
    `stage_spec could not resolve these layout hint reference(s): ${detail}.`,
    unknown.map((ref) => ({
      severity: 'error',
      rule: 'stage-spec/unknown-layout-reference',
      message: `${ref.field} reference '${ref.value}' was not found in the declared spec tab.`,
      context: { field: ref.field, value: ref.value },
    })),
  );
}

function survivingPinnedKeys(
  priorSpec: AuthoringSpec,
  nextSpec: AuthoringSpec,
  tabId: string,
): ReadonlySet<string> {
  const priorTab = priorSpec.tabs.find((candidate) => candidate.id === tabId);
  const nextTab = nextSpec.tabs.find((candidate) => candidate.id === tabId);
  if (priorTab === undefined || nextTab === undefined) return new Set();
  const priorKeys = new Set([
    ...priorTab.nodes.map((node) => node.key),
    ...(priorTab.junctions ?? []).map((junction) => junction.key),
    ...priorTab.groups.map((group) => group.key),
    ...priorTab.comments.map((comment) => comment.key),
  ]);
  return new Set([
    ...nextTab.nodes.map((node) => node.key).filter((key) => priorKeys.has(key)),
    ...(nextTab.junctions ?? [])
      .map((junction) => junction.key)
      .filter((key) => priorKeys.has(key)),
    ...nextTab.groups.map((group) => group.key).filter((key) => priorKeys.has(key)),
    ...nextTab.comments.map((comment) => comment.key).filter((key) => priorKeys.has(key)),
  ]);
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
  const junctions = laidTab.junctions?.map((junction) =>
    pinned.has(junction.key)
      ? (priorJunctions.get(junction.key) ?? junction)
      : translateJunction(junction, dy),
  );
  return {
    ...laidTab,
    nodes: laidTab.nodes.map((node) =>
      pinned.has(node.key) ? (priorNodes.get(node.key) ?? node) : translateNode(node, dy),
    ),
    groups: laidTab.groups.map((group) =>
      pinned.has(group.key) ? (priorGroups.get(group.key) ?? group) : translateGroup(group, dy),
    ),
    comments: laidTab.comments.map((comment) =>
      pinned.has(comment.key)
        ? (priorComments.get(comment.key) ?? comment)
        : translateComment(comment, dy),
    ),
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

const passthroughJsonSchema = {
  type: 'object',
  additionalProperties: true,
  not: {
    anyOf: GEOMETRY_FIELDS.map((field) => ({ required: [field] })),
  },
  description: COMPUTED_PLACEMENT_MESSAGE,
} as const;

const loosePassthroughJsonSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

const forbiddenGeometryJsonSchema = {
  not: {},
  description: COMPUTED_PLACEMENT_MESSAGE,
} as const;

const widgetAnchorJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'refKey'],
  properties: {
    kind: { type: 'string', enum: ['group', 'page', 'ui'] },
    refKey: { type: 'string', minLength: 1 },
  },
} as const;

const nodeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'type'],
  properties: {
    key: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    label: { type: 'string' },
    info: { type: 'string' },
    groupKey: { type: 'string', minLength: 1 },
    widgetAnchor: widgetAnchorJsonSchema,
    passthrough: passthroughJsonSchema,
    x: forbiddenGeometryJsonSchema,
    y: forbiddenGeometryJsonSchema,
    position: forbiddenGeometryJsonSchema,
    w: forbiddenGeometryJsonSchema,
    h: forbiddenGeometryJsonSchema,
  },
} as const;

const groupJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'name', 'nodeKeys'],
  properties: {
    key: { type: 'string', minLength: 1 },
    name: { type: 'string' },
    nodeKeys: { type: 'array', items: { type: 'string', minLength: 1 } },
    parentKey: { type: 'string', minLength: 1 },
    info: { type: 'string' },
    style: loosePassthroughJsonSchema,
    passthrough: passthroughJsonSchema,
    x: forbiddenGeometryJsonSchema,
    y: forbiddenGeometryJsonSchema,
    position: forbiddenGeometryJsonSchema,
    w: forbiddenGeometryJsonSchema,
    h: forbiddenGeometryJsonSchema,
  },
} as const;

const commentJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'text'],
  properties: {
    key: { type: 'string', minLength: 1 },
    text: { type: 'string' },
    info: { type: 'string' },
    groupKey: { type: 'string', minLength: 1 },
    x: forbiddenGeometryJsonSchema,
    y: forbiddenGeometryJsonSchema,
    position: forbiddenGeometryJsonSchema,
    w: forbiddenGeometryJsonSchema,
    h: forbiddenGeometryJsonSchema,
  },
} as const;

const junctionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key'],
  properties: {
    key: { type: 'string', minLength: 1 },
    name: { type: 'string' },
    groupKey: { type: 'string', minLength: 1 },
    disabled: { type: 'boolean' },
    x: forbiddenGeometryJsonSchema,
    y: forbiddenGeometryJsonSchema,
    position: forbiddenGeometryJsonSchema,
    w: forbiddenGeometryJsonSchema,
    h: forbiddenGeometryJsonSchema,
  },
} as const;

const connectionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fromKey', 'outputPort', 'toKey'],
  properties: {
    fromKey: { type: 'string', minLength: 1 },
    outputPort: { type: 'integer', minimum: 0 },
    toKey: { type: 'string', minLength: 1 },
  },
} as const;

const envEntryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type'],
  properties: {
    name: { type: 'string', minLength: 1 },
    type: {
      type: 'string',
      enum: ['str', 'num', 'bool', 'json', 'env', 'cred', 'jsonata', 'conf-type'],
    },
    value: {},
    ui: { type: 'object', additionalProperties: true },
  },
} as const;

const tabJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'nodes', 'connections'],
  properties: {
    id: { type: 'string', minLength: 1 },
    label: { type: 'string', minLength: 1 },
    disabled: { type: 'boolean' },
    info: { type: 'string' },
    locked: { type: 'boolean' },
    env: { type: 'array', items: envEntryJsonSchema },
    nodes: { type: 'array', items: nodeJsonSchema },
    connections: { type: 'array', items: connectionJsonSchema },
    groups: { type: 'array', items: groupJsonSchema },
    comments: { type: 'array', items: commentJsonSchema },
    junctions: { type: 'array', items: junctionJsonSchema },
    passthrough: loosePassthroughJsonSchema,
  },
} as const;

const configNodeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'type'],
  properties: {
    key: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    label: { type: 'string' },
    passthrough: loosePassthroughJsonSchema,
  },
} as const;

const subflowDefJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'nodes', 'connections'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    info: { type: 'string' },
    env: { type: 'array', items: envEntryJsonSchema },
    nodes: { type: 'array', items: nodeJsonSchema },
    connections: { type: 'array', items: connectionJsonSchema },
    junctions: { type: 'array', items: junctionJsonSchema },
    passthrough: loosePassthroughJsonSchema,
  },
} as const;

export const specJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tabs'],
  properties: {
    tabs: { type: 'array', minItems: 1, items: tabJsonSchema },
    configNodes: { type: 'array', items: configNodeJsonSchema },
    subflowDefs: { type: 'array', items: subflowDefJsonSchema },
  },
} as const;

export const tabLayoutHintsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lane_hints: {
      type: 'object',
      additionalProperties: { type: 'string', enum: [...LANE_NAMES] },
      description: 'Lane hints keyed by node, junction, or group key. Not persisted.',
    },
    section_order: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description: 'Optional order of section ids or group keys for this layout run.',
    },
  },
} as const;

export const layoutHintsJsonSchema = {
  ...tabLayoutHintsJsonSchema,
  properties: {
    ...tabLayoutHintsJsonSchema.properties,
    per_tab: {
      type: 'object',
      additionalProperties: tabLayoutHintsJsonSchema,
      description:
        'Per-tab layout hints keyed by declared tab authoring key. Use this for multi-tab specs.',
    },
  },
} as const;
