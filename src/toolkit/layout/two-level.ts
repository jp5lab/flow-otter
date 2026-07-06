import type {
  CommentSpec,
  GroupSpec,
  JunctionSpec,
  NodeSpec,
  Position,
  TabSpec,
} from '../authoring/types.js';
import { LANE_GAP, LANE_ORDER, deriveTabSpecLanes, type Lane } from '../lanes.js';
import { editorGeometryProvider } from '../render/metrics.js';

import type { LayoutParticipantDimensions } from './apply-positions.js';
import { DEFAULT_GRID, snapToGrid } from './grid.js';
import { deriveTabSpecSections, type Section } from './sections.js';
import { stackVertical, translateRect, unionRect, unionRects, type LayoutRect } from './stack.js';
import type {
  ElkCoreLayoutResult,
  ElkGroupBounds,
  ElkLayoutCore,
  ElkResolvedLayoutOpts,
} from './elk.js';

const GROUP_MIN_EXTENT = DEFAULT_GRID * 2;

interface GroupFacts {
  readonly groupsByKey: ReadonlyMap<string, GroupSpec>;
  readonly childrenByParentKey: ReadonlyMap<string, readonly string[]>;
  readonly descendantKeysByGroupKey: ReadonlyMap<string, ReadonlySet<string>>;
  readonly depthByGroupKey: ReadonlyMap<string, number>;
}

interface PartitionPlan {
  readonly participantSectionByKey: ReadonlyMap<string, string>;
  readonly participantLaneByKey: ReadonlyMap<string, Lane>;
  readonly groupSectionByKey: ReadonlyMap<string, string>;
  readonly groupLaneByKey: ReadonlyMap<string, Lane>;
  readonly facts: GroupFacts;
}

interface PartialLayout {
  readonly centersByKey: ReadonlyMap<string, Position>;
  readonly dimensionsByKey: ReadonlyMap<string, LayoutParticipantDimensions>;
  readonly groupRectsByKey: ReadonlyMap<string, LayoutRect>;
  readonly headerCentersByKey: ReadonlyMap<string, Position>;
  readonly headerDimensionsByKey: ReadonlyMap<string, LayoutParticipantDimensions>;
  readonly extent: LayoutRect;
}

interface MutableLayout {
  readonly centersByKey: Map<string, Position>;
  readonly dimensionsByKey: Map<string, LayoutParticipantDimensions>;
  readonly groupRectsByKey: Map<string, LayoutRect>;
  readonly headerCentersByKey: Map<string, Position>;
  readonly headerDimensionsByKey: Map<string, LayoutParticipantDimensions>;
}

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function participantKeys(tab: TabSpec): Set<string> {
  return new Set([
    ...tab.nodes.map((node) => node.key),
    ...(tab.junctions ?? []).map((junction) => junction.key),
  ]);
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, new Set([value]));
    return;
  }
  existing.add(value);
}

function buildGroupFacts(tab: TabSpec): GroupFacts {
  const keys = participantKeys(tab);
  const groupsByKey = new Map(tab.groups.map((group) => [group.key, group]));
  const directMembersByGroupKey = new Map<string, Set<string>>();
  const childrenByParentKey = new Map<string, Set<string>>();

  for (const group of tab.groups) {
    for (const memberKey of group.nodeKeys) {
      if (keys.has(memberKey)) addToSetMap(directMembersByGroupKey, group.key, memberKey);
    }
    if (group.parentKey !== undefined && groupsByKey.has(group.parentKey)) {
      addToSetMap(childrenByParentKey, group.parentKey, group.key);
    }
  }
  for (const node of tab.nodes) {
    if (node.groupKey !== undefined && groupsByKey.has(node.groupKey)) {
      addToSetMap(directMembersByGroupKey, node.groupKey, node.key);
    }
  }
  for (const junction of tab.junctions ?? []) {
    if (junction.groupKey !== undefined && groupsByKey.has(junction.groupKey)) {
      addToSetMap(directMembersByGroupKey, junction.groupKey, junction.key);
    }
  }

  const descendantsMemo = new Map<string, ReadonlySet<string>>();
  const descendantsOf = (groupKey: string, seen: ReadonlySet<string>): ReadonlySet<string> => {
    const memo = descendantsMemo.get(groupKey);
    if (memo !== undefined) return memo;
    const descendants = new Set(directMembersByGroupKey.get(groupKey) ?? []);
    const nextSeen = new Set(seen);
    nextSeen.add(groupKey);
    for (const childKey of childrenByParentKey.get(groupKey) ?? []) {
      if (nextSeen.has(childKey)) continue;
      for (const memberKey of descendantsOf(childKey, nextSeen)) descendants.add(memberKey);
    }
    descendantsMemo.set(groupKey, descendants);
    return descendants;
  };

  const depthMemo = new Map<string, number>();
  const depthOf = (groupKey: string, seen: ReadonlySet<string>): number => {
    const memo = depthMemo.get(groupKey);
    if (memo !== undefined) return memo;
    const group = groupsByKey.get(groupKey);
    const parentKey = group?.parentKey;
    if (parentKey === undefined || !groupsByKey.has(parentKey) || seen.has(parentKey)) {
      depthMemo.set(groupKey, 0);
      return 0;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(groupKey);
    const depth = depthOf(parentKey, nextSeen) + 1;
    depthMemo.set(groupKey, depth);
    return depth;
  };

  const descendantKeysByGroupKey = new Map<string, ReadonlySet<string>>();
  const depthByGroupKey = new Map<string, number>();
  for (const group of tab.groups) {
    descendantKeysByGroupKey.set(group.key, descendantsOf(group.key, new Set()));
    depthByGroupKey.set(group.key, depthOf(group.key, new Set()));
  }

  return {
    groupsByKey,
    childrenByParentKey: new Map(
      [...childrenByParentKey].map(([key, values]) => [key, [...values].sort(compareString)]),
    ),
    descendantKeysByGroupKey,
    depthByGroupKey,
  };
}

function orderedGroupsByDepth(tab: TabSpec, facts: GroupFacts): GroupSpec[] {
  return [...tab.groups].sort((a, b) => {
    const depth = (facts.depthByGroupKey.get(a.key) ?? 0) - (facts.depthByGroupKey.get(b.key) ?? 0);
    if (depth !== 0) return depth;
    return compareString(a.key, b.key);
  });
}

function chooseLane(lanes: readonly Lane[]): Lane {
  const counts = new Map<Lane, number>();
  for (const lane of lanes) counts.set(lane, (counts.get(lane) ?? 0) + 1);
  let best: Lane = LANE_ORDER[0];
  let bestCount = -1;
  for (const lane of LANE_ORDER) {
    const count = counts.get(lane) ?? 0;
    if (count > bestCount) {
      best = lane;
      bestCount = count;
    }
  }
  return best;
}

function chooseSection(
  sectionIds: readonly string[],
  sectionOrderById: ReadonlyMap<string, number>,
): string | undefined {
  const counts = new Map<string, number>();
  for (const sectionId of sectionIds) counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
  return [...counts].sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1];
    const aIndex = sectionOrderById.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = sectionOrderById.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return compareString(a[0], b[0]);
  })[0]?.[0];
}

function emitGroupLaneDiagnostic(
  tab: TabSpec,
  group: GroupSpec,
  lanes: readonly Lane[],
  opts: ElkResolvedLayoutOpts,
): void {
  const uniqueLanes = [...new Set(lanes)];
  if (uniqueLanes.length <= 1) return;
  opts.onDiagnostic?.({
    severity: 'warning',
    rule: 'layout/group-spans-lanes',
    tabId: tab.id,
    message: `Group '${group.key}' spans lanes and will be laid out in its majority lane.`,
    context: {
      groupKey: group.key,
      lanes: uniqueLanes,
    },
  });
}

function buildPartitionPlan(
  tab: TabSpec,
  sections: readonly Section[],
  opts: ElkResolvedLayoutOpts,
): PartitionPlan {
  const laneDerivation = deriveTabSpecLanes(tab);
  const sectionDerivation = deriveTabSpecSections(tab);
  const facts = buildGroupFacts(tab);
  const sectionOrderById = new Map(sections.map((section, index) => [section.id, index]));
  const participantLaneByKey = new Map<string, Lane>();
  const participantSectionByKey = new Map<string, string>();

  for (const key of participantKeys(tab)) {
    participantLaneByKey.set(key, laneDerivation.lanesById.get(key) ?? 'main');
    const sectionId = sectionDerivation.sectionIdByMemberId.get(key);
    if (sectionId !== undefined) participantSectionByKey.set(key, sectionId);
  }

  const ownGroupLaneByKey = new Map<string, Lane>();
  const ownGroupSectionByKey = new Map<string, string>();
  for (const group of tab.groups) {
    const descendants = [...(facts.descendantKeysByGroupKey.get(group.key) ?? [])];
    if (descendants.length === 0) continue;
    const lanes = descendants.map((key) => participantLaneByKey.get(key) ?? 'main');
    emitGroupLaneDiagnostic(tab, group, lanes, opts);
    ownGroupLaneByKey.set(group.key, chooseLane(lanes));
    const sectionId = chooseSection(
      descendants
        .map((key) => participantSectionByKey.get(key))
        .filter((candidate): candidate is string => candidate !== undefined),
      sectionOrderById,
    );
    if (sectionId !== undefined) ownGroupSectionByKey.set(group.key, sectionId);
  }

  const groupLaneByKey = new Map<string, Lane>();
  const groupSectionByKey = new Map<string, string>();
  for (const group of orderedGroupsByDepth(tab, facts)) {
    const parentLane =
      group.parentKey !== undefined ? groupLaneByKey.get(group.parentKey) : undefined;
    const parentSection =
      group.parentKey !== undefined ? groupSectionByKey.get(group.parentKey) : undefined;
    const lane = parentLane ?? ownGroupLaneByKey.get(group.key);
    const sectionId = parentSection ?? ownGroupSectionByKey.get(group.key);
    if (lane !== undefined) groupLaneByKey.set(group.key, lane);
    if (sectionId !== undefined) groupSectionByKey.set(group.key, sectionId);
  }

  for (const group of orderedGroupsByDepth(tab, facts)) {
    const lane = groupLaneByKey.get(group.key);
    const sectionId = groupSectionByKey.get(group.key);
    for (const key of facts.descendantKeysByGroupKey.get(group.key) ?? []) {
      if (lane !== undefined) participantLaneByKey.set(key, lane);
      if (sectionId !== undefined) participantSectionByKey.set(key, sectionId);
    }
  }

  return {
    participantSectionByKey,
    participantLaneByKey,
    groupSectionByKey,
    groupLaneByKey,
    facts,
  };
}

function emitCrossLaneDiagnostics(
  tab: TabSpec,
  plan: PartitionPlan,
  opts: ElkResolvedLayoutOpts,
): void {
  for (const connection of tab.connections) {
    const fromLane = plan.participantLaneByKey.get(connection.fromKey);
    const toLane = plan.participantLaneByKey.get(connection.toKey);
    if (fromLane === undefined || toLane === undefined || fromLane === toLane) continue;
    opts.onDiagnostic?.({
      severity: 'info',
      rule: 'layout/cross-lane-wire',
      tabId: tab.id,
      message: `Wire '${connection.fromKey}' -> '${connection.toKey}' crosses layout lanes.`,
      context: {
        fromKey: connection.fromKey,
        toKey: connection.toKey,
        fromLane,
        toLane,
      },
    });
  }
}

function groupBelongsToLane(
  group: GroupSpec,
  sectionId: string,
  lane: Lane,
  plan: PartitionPlan,
): boolean {
  return (
    plan.groupSectionByKey.get(group.key) === sectionId &&
    plan.groupLaneByKey.get(group.key) === lane
  );
}

function subgraphParticipantKeys(
  tab: TabSpec,
  sectionId: string,
  lane: Lane,
  plan: PartitionPlan,
): Set<string> {
  const keys = new Set<string>();
  for (const node of tab.nodes) {
    if (
      plan.participantSectionByKey.get(node.key) === sectionId &&
      plan.participantLaneByKey.get(node.key) === lane
    ) {
      keys.add(node.key);
    }
  }
  for (const junction of tab.junctions ?? []) {
    if (
      plan.participantSectionByKey.get(junction.key) === sectionId &&
      plan.participantLaneByKey.get(junction.key) === lane
    ) {
      keys.add(junction.key);
    }
  }
  return keys;
}

function includedGroupKeys(
  tab: TabSpec,
  sectionId: string,
  lane: Lane,
  keys: ReadonlySet<string>,
  plan: PartitionPlan,
): Set<string> {
  const included = new Set<string>();
  for (const group of tab.groups) {
    if (!groupBelongsToLane(group, sectionId, lane, plan)) continue;
    const descendants = plan.facts.descendantKeysByGroupKey.get(group.key) ?? new Set<string>();
    if ([...descendants].some((key) => keys.has(key))) included.add(group.key);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of tab.groups) {
      if (!included.has(group.key) || group.parentKey === undefined) continue;
      if (!groupBelongsToLane(group, sectionId, lane, plan)) continue;
      if (included.has(group.parentKey)) continue;
      included.add(group.parentKey);
      changed = true;
    }
  }
  return included;
}

function subgraphGroup(
  group: GroupSpec,
  keys: ReadonlySet<string>,
  groups: ReadonlySet<string>,
): GroupSpec {
  const { parentKey, ...rest } = group;
  return {
    ...rest,
    nodeKeys: group.nodeKeys.filter((key) => keys.has(key)),
    ...(parentKey !== undefined && groups.has(parentKey) ? { parentKey } : {}),
  };
}

function subgraphTab(
  tab: TabSpec,
  sectionId: string,
  lane: Lane,
  plan: PartitionPlan,
): TabSpec | undefined {
  const keys = subgraphParticipantKeys(tab, sectionId, lane, plan);
  if (keys.size === 0) return undefined;
  const groups = includedGroupKeys(tab, sectionId, lane, keys, plan);
  const nodes = tab.nodes.filter((node) => keys.has(node.key));
  const junctions = (tab.junctions ?? []).filter((junction) => keys.has(junction.key));
  const connections = tab.connections.filter(
    (connection) => keys.has(connection.fromKey) && keys.has(connection.toKey),
  );
  return {
    ...tab,
    nodes,
    junctions,
    connections,
    groups: tab.groups
      .filter((group) => groups.has(group.key))
      .map((group) => subgraphGroup(group, keys, groups)),
    comments: [],
  };
}

function commentDimensions(comment: CommentSpec): LayoutParticipantDimensions {
  return (
    comment.size ??
    editorGeometryProvider.nodeDimensionsFor(comment.text, {
      inputs: 0,
      outputs: 0,
    })
  );
}

function centeredRect(center: Position, dims: LayoutParticipantDimensions): LayoutRect {
  return {
    x1: center.x - dims.w / 2,
    y1: center.y - dims.h / 2,
    x2: center.x + dims.w / 2,
    y2: center.y + dims.h / 2,
  };
}

function groupBoundsToRect(bounds: ElkGroupBounds): LayoutRect {
  return {
    x1: bounds.position.x,
    y1: bounds.position.y,
    x2: bounds.position.x + bounds.size.w,
    y2: bounds.position.y + bounds.size.h,
  };
}

function snapRectOutward(rect: LayoutRect, grid: number, minExtent = 0): LayoutRect {
  const x1 = Math.floor(rect.x1 / grid) * grid;
  const y1 = Math.floor(rect.y1 / grid) * grid;
  const x2 = Math.max(Math.ceil(rect.x2 / grid) * grid, x1 + minExtent);
  const y2 = Math.max(Math.ceil(rect.y2 / grid) * grid, y1 + minExtent);
  return { x1, y1, x2, y2 };
}

function layoutExtent(layout: MutableLayout): LayoutRect | undefined {
  const rects: LayoutRect[] = [];
  for (const [key, center] of layout.centersByKey) {
    const dims = layout.dimensionsByKey.get(key);
    if (dims !== undefined) rects.push(centeredRect(center, dims));
  }
  rects.push(...layout.groupRectsByKey.values());
  for (const [key, center] of layout.headerCentersByKey) {
    const dims = layout.headerDimensionsByKey.get(key);
    if (dims !== undefined) rects.push(centeredRect(center, dims));
  }
  return unionRects(rects);
}

function placeHeaders(
  tab: TabSpec,
  core: ElkCoreLayoutResult,
  groupRectsByKey: ReadonlyMap<string, LayoutRect>,
  sectionDerivation: ReturnType<typeof deriveTabSpecSections>,
  opts: ElkResolvedLayoutOpts,
): {
  readonly headerCentersByKey: ReadonlyMap<string, Position>;
  readonly headerDimensionsByKey: ReadonlyMap<string, LayoutParticipantDimensions>;
} {
  const commentsByKey = new Map(tab.comments.map((comment) => [comment.key, comment]));
  const commentIndexByKey = new Map(tab.comments.map((comment, index) => [comment.key, index]));
  const headerCentersByKey = new Map<string, Position>();
  const headerDimensionsByKey = new Map<string, LayoutParticipantDimensions>();
  const groupKeys = [...core.groupBoundsByKey.keys()].sort(compareString);

  for (const groupKey of groupKeys) {
    const groupRect = groupRectsByKey.get(groupKey);
    if (groupRect === undefined) continue;
    const commentIds = [...(sectionDerivation.headerCommentIdsByGroupId.get(groupKey) ?? [])].sort(
      (a, b) =>
        (commentIndexByKey.get(a) ?? 0) - (commentIndexByKey.get(b) ?? 0) || compareString(a, b),
    );
    let nextBottom = groupRect.y1 - opts.grid;
    for (const commentId of commentIds) {
      const comment = commentsByKey.get(commentId);
      if (comment === undefined) continue;
      const dims = commentDimensions(comment);
      let center = snapToGrid(
        {
          x: groupRect.x1 + (groupRect.x2 - groupRect.x1) / 2,
          y: nextBottom - dims.h / 2,
        },
        opts.grid,
      );
      while (center.y + dims.h / 2 >= groupRect.y1) {
        center = { ...center, y: center.y - opts.grid };
      }
      headerCentersByKey.set(commentId, center);
      headerDimensionsByKey.set(commentId, dims);
      nextBottom = center.y - dims.h / 2 - opts.grid;
    }
  }

  return { headerCentersByKey, headerDimensionsByKey };
}

function mutableLayoutFromCore(
  tab: TabSpec,
  core: ElkCoreLayoutResult,
  sectionDerivation: ReturnType<typeof deriveTabSpecSections>,
  opts: ElkResolvedLayoutOpts,
): PartialLayout | undefined {
  const groupRectsByKey = new Map<string, LayoutRect>();
  for (const [key, bounds] of core.groupBoundsByKey) {
    groupRectsByKey.set(
      key,
      snapRectOutward(groupBoundsToRect(bounds), opts.grid, GROUP_MIN_EXTENT),
    );
  }
  const headers = placeHeaders(tab, core, groupRectsByKey, sectionDerivation, opts);
  const layout: MutableLayout = {
    centersByKey: new Map(core.centerByKey),
    dimensionsByKey: new Map(core.dimensionsByKey),
    groupRectsByKey,
    headerCentersByKey: new Map(headers.headerCentersByKey),
    headerDimensionsByKey: new Map(headers.headerDimensionsByKey),
  };
  const extent = layoutExtent(layout);
  if (extent === undefined) return undefined;
  return { ...layout, extent };
}

function translateLayout(layout: PartialLayout, dx: number, dy: number): PartialLayout {
  const translateCenter = (position: Position): Position => ({
    x: position.x + dx,
    y: position.y + dy,
  });
  const centersByKey = new Map<string, Position>();
  for (const [key, position] of layout.centersByKey)
    centersByKey.set(key, translateCenter(position));
  const groupRectsByKey = new Map<string, LayoutRect>();
  for (const [key, rect] of layout.groupRectsByKey) {
    groupRectsByKey.set(key, translateRect(rect, dx, dy));
  }
  const headerCentersByKey = new Map<string, Position>();
  for (const [key, position] of layout.headerCentersByKey) {
    headerCentersByKey.set(key, translateCenter(position));
  }
  return {
    centersByKey,
    dimensionsByKey: layout.dimensionsByKey,
    groupRectsByKey,
    headerCentersByKey,
    headerDimensionsByKey: layout.headerDimensionsByKey,
    extent: translateRect(layout.extent, dx, dy),
  };
}

function mergeLayout(target: MutableLayout, source: PartialLayout): void {
  for (const [key, value] of source.centersByKey) target.centersByKey.set(key, value);
  for (const [key, value] of source.dimensionsByKey) target.dimensionsByKey.set(key, value);
  for (const [key, value] of source.groupRectsByKey) target.groupRectsByKey.set(key, value);
  for (const [key, value] of source.headerCentersByKey) target.headerCentersByKey.set(key, value);
  for (const [key, value] of source.headerDimensionsByKey) {
    target.headerDimensionsByKey.set(key, value);
  }
}

async function layoutLane(
  tab: TabSpec,
  sectionId: string,
  lane: Lane,
  plan: PartitionPlan,
  sectionDerivation: ReturnType<typeof deriveTabSpecSections>,
  opts: ElkResolvedLayoutOpts,
  core: ElkLayoutCore,
): Promise<PartialLayout | undefined | 'engine-error'> {
  const laneTab = subgraphTab(tab, sectionId, lane, plan);
  if (laneTab === undefined) return undefined;
  const laid = await core(laneTab, opts);
  if (laid === undefined) return 'engine-error';
  return mutableLayoutFromCore(tab, laid, sectionDerivation, opts);
}

function stackLayouts(layouts: readonly PartialLayout[], gap: number): PartialLayout[] {
  const stacked = stackVertical(
    layouts.map((layout, index) => ({ key: String(index), rect: layout.extent })),
    { gap },
  );
  return stacked.map((item, index) => translateLayout(layouts[index]!, item.dx, item.dy));
}

async function layoutSection(
  tab: TabSpec,
  section: Section,
  plan: PartitionPlan,
  sectionDerivation: ReturnType<typeof deriveTabSpecSections>,
  opts: ElkResolvedLayoutOpts,
  core: ElkLayoutCore,
): Promise<PartialLayout | undefined | 'engine-error'> {
  const laneLayouts: PartialLayout[] = [];
  for (const lane of LANE_ORDER) {
    const layout = await layoutLane(tab, section.id, lane, plan, sectionDerivation, opts, core);
    if (layout === 'engine-error') return layout;
    if (layout !== undefined) laneLayouts.push(layout);
  }
  if (laneLayouts.length === 0) return undefined;
  const stackedLanes = stackLayouts(laneLayouts, LANE_GAP);
  const merged: MutableLayout = {
    centersByKey: new Map(),
    dimensionsByKey: new Map(),
    groupRectsByKey: new Map(),
    headerCentersByKey: new Map(),
    headerDimensionsByKey: new Map(),
  };
  for (const layout of stackedLanes) mergeLayout(merged, layout);
  const extent = layoutExtent(merged);
  return extent === undefined ? undefined : { ...merged, extent };
}

function participantGroupKeyByKey(tab: TabSpec): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const group of tab.groups) {
    for (const key of group.nodeKeys) {
      if (!out.has(key)) out.set(key, group.key);
    }
  }
  for (const node of tab.nodes) {
    if (node.groupKey !== undefined) out.set(node.key, node.groupKey);
  }
  for (const junction of tab.junctions ?? []) {
    if (junction.groupKey !== undefined) out.set(junction.key, junction.groupKey);
  }
  return out;
}

function expandGroupRectsForContainment(
  tab: TabSpec,
  layout: MutableLayout,
  plan: PartitionPlan,
  opts: ElkResolvedLayoutOpts,
): void {
  const participantGroupKey = participantGroupKeyByKey(tab);
  const groups = orderedGroupsByDepth(tab, plan.facts).reverse();
  for (const group of groups) {
    const groupRect = layout.groupRectsByKey.get(group.key);
    if (groupRect === undefined) continue;
    let required = groupRect;
    for (const key of plan.facts.descendantKeysByGroupKey.get(group.key) ?? []) {
      const center = layout.centersByKey.get(key);
      const dims = layout.dimensionsByKey.get(key);
      if (center !== undefined && dims !== undefined) {
        required = unionRect(required, centeredRect(center, dims));
      }
      const directGroupKey = participantGroupKey.get(key);
      if (directGroupKey !== undefined && directGroupKey !== group.key) {
        const childRect = layout.groupRectsByKey.get(directGroupKey);
        if (childRect !== undefined) required = unionRect(required, childRect);
      }
    }
    for (const childKey of plan.facts.childrenByParentKey.get(group.key) ?? []) {
      const childRect = layout.groupRectsByKey.get(childKey);
      if (childRect !== undefined) required = unionRect(required, childRect);
    }
    layout.groupRectsByKey.set(group.key, snapRectOutward(required, opts.grid, GROUP_MIN_EXTENT));
  }
}

function emitWidthOverflow(tab: TabSpec, rect: LayoutRect, opts: ElkResolvedLayoutOpts): void {
  const width = rect.x2 - rect.x1;
  const boundsWidth = opts.bounds.xMax - opts.bounds.xMin;
  if (width <= boundsWidth) return;
  opts.onDiagnostic?.({
    severity: 'warning',
    rule: 'layout/width-overflow',
    tabId: tab.id,
    message: `Layout for tab '${tab.label}' is ${Math.round(width)}px wide, exceeding the ${boundsWidth}px layout bounds.`,
    context: {
      width,
      boundsWidth,
      overflowPx: width - boundsWidth,
    },
  });
}

function anchorBounds(
  layout: MutableLayout,
):
  | { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
  | undefined {
  const points: Position[] = [
    ...layout.centersByKey.values(),
    ...layout.headerCentersByKey.values(),
    ...[...layout.groupRectsByKey.values()].map((rect) => ({ x: rect.x1, y: rect.y1 })),
    ...[...layout.groupRectsByKey.values()].map((rect) => ({ x: rect.x2, y: rect.y2 })),
  ];
  if (points.length === 0) return undefined;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function translateDelta(min: number, max: number, minBound: number, maxBound: number): number {
  const span = max - min;
  const boundSpan = maxBound - minBound;
  if (span > boundSpan) return min < minBound ? minBound - min : 0;
  if (min < minBound) return minBound - min;
  if (max > maxBound) return maxBound - max;
  return 0;
}

function finalSnapAndTranslate(
  tab: TabSpec,
  layout: MutableLayout,
  plan: PartitionPlan,
  opts: ElkResolvedLayoutOpts,
): MutableLayout {
  const snapped: MutableLayout = {
    centersByKey: new Map(),
    dimensionsByKey: new Map(layout.dimensionsByKey),
    groupRectsByKey: new Map(),
    headerCentersByKey: new Map(),
    headerDimensionsByKey: new Map(layout.headerDimensionsByKey),
  };
  for (const [key, position] of layout.centersByKey) {
    snapped.centersByKey.set(key, snapToGrid(position, opts.grid));
  }
  for (const [key, position] of layout.headerCentersByKey) {
    snapped.headerCentersByKey.set(key, snapToGrid(position, opts.grid));
  }
  for (const [key, rect] of layout.groupRectsByKey) {
    snapped.groupRectsByKey.set(key, snapRectOutward(rect, opts.grid, GROUP_MIN_EXTENT));
  }
  expandGroupRectsForContainment(tab, snapped, plan, opts);
  const contentRect = layoutExtent(snapped);
  if (contentRect !== undefined) emitWidthOverflow(tab, contentRect, opts);
  const anchors = anchorBounds(snapped);
  if (anchors === undefined) return snapped;
  const dx = translateDelta(anchors.minX, anchors.maxX, opts.bounds.xMin, opts.bounds.xMax);
  const dy = translateDelta(anchors.minY, anchors.maxY, opts.bounds.yMin, opts.bounds.yMax);
  if (dx === 0 && dy === 0) return snapped;
  const translated = translateLayout(
    {
      ...snapped,
      extent: contentRect ?? { x1: 0, y1: 0, x2: 0, y2: 0 },
    },
    dx,
    dy,
  );
  return {
    centersByKey: new Map(
      [...translated.centersByKey].map(([key, value]) => [key, snapToGrid(value, opts.grid)]),
    ),
    dimensionsByKey: new Map(translated.dimensionsByKey),
    groupRectsByKey: new Map(
      [...translated.groupRectsByKey].map(([key, rect]) => [
        key,
        snapRectOutward(rect, opts.grid, GROUP_MIN_EXTENT),
      ]),
    ),
    headerCentersByKey: new Map(
      [...translated.headerCentersByKey].map(([key, value]) => [key, snapToGrid(value, opts.grid)]),
    ),
    headerDimensionsByKey: new Map(translated.headerDimensionsByKey),
  };
}

function groupSpecWithRect(group: GroupSpec, rect: LayoutRect): GroupSpec {
  return {
    ...group,
    position: { x: rect.x1, y: rect.y1 },
    size: { w: rect.x2 - rect.x1, h: rect.y2 - rect.y1 },
  };
}

function applyLayout(tab: TabSpec, layout: MutableLayout): TabSpec {
  const nodes: NodeSpec[] = tab.nodes.map((node) => {
    const position = layout.centersByKey.get(node.key);
    return position === undefined ? node : { ...node, position };
  });
  const junctions: JunctionSpec[] | undefined = tab.junctions?.map((junction) => {
    const position = layout.centersByKey.get(junction.key);
    return position === undefined ? junction : { ...junction, position };
  });
  const groups: GroupSpec[] = tab.groups.map((group) => {
    const rect = layout.groupRectsByKey.get(group.key);
    return rect === undefined ? group : groupSpecWithRect(group, rect);
  });
  const comments: CommentSpec[] = tab.comments.map((comment) => {
    const position = layout.headerCentersByKey.get(comment.key);
    return position === undefined ? comment : { ...comment, position };
  });
  return {
    ...tab,
    nodes,
    groups,
    comments,
    ...(junctions !== undefined ? { junctions } : {}),
  };
}

export async function layoutTabWithTwoLevel(
  tab: TabSpec,
  opts: ElkResolvedLayoutOpts,
  core: ElkLayoutCore,
): Promise<TabSpec> {
  const sectionDerivation = deriveTabSpecSections(tab);
  if (sectionDerivation.sections.length === 0) return tab;
  const plan = buildPartitionPlan(tab, sectionDerivation.sections, opts);
  emitCrossLaneDiagnostics(tab, plan, opts);

  const sectionLayouts: PartialLayout[] = [];
  for (const section of sectionDerivation.sections) {
    const layout = await layoutSection(tab, section, plan, sectionDerivation, opts, core);
    if (layout === 'engine-error') return tab;
    if (layout !== undefined) sectionLayouts.push(layout);
  }
  if (sectionLayouts.length === 0) return tab;

  const stackedSections = stackLayouts(sectionLayouts, opts.ranksep);
  const merged: MutableLayout = {
    centersByKey: new Map(),
    dimensionsByKey: new Map(),
    groupRectsByKey: new Map(),
    headerCentersByKey: new Map(),
    headerDimensionsByKey: new Map(),
  };
  for (const layout of stackedSections) mergeLayout(merged, layout);
  const finalLayout = finalSnapAndTranslate(tab, merged, plan, opts);
  return applyLayout(tab, finalLayout);
}
