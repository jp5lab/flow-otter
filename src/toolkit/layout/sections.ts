import {
  configByReferenceIds,
  hasCanvasPosition,
  isComment,
  isConfigShapedNode,
  isGroup,
  isJunction,
  isRegularNode,
  isTab,
  type FlowsJson,
  type FlowsJsonNode,
} from '../../shared/flows-json.js';
import type { CommentSpec, GroupSpec, TabSpec } from '../authoring/types.js';

const HEADER_VERTICAL_GAP = 80;

export interface Section {
  readonly id: string;
  readonly memberIds: readonly string[];
  readonly minDeclarationIndex: number;
  readonly groupIds: readonly string[];
  readonly headerCommentIds: readonly string[];
}

export interface SectionDerivation {
  readonly sections: readonly Section[];
  readonly sectionIdByMemberId: ReadonlyMap<string, string>;
  readonly sectionIdsByGroupId: ReadonlyMap<string, readonly string[]>;
  readonly headerGroupIdByCommentId: ReadonlyMap<string, string>;
  readonly headerCommentIdsByGroupId: ReadonlyMap<string, readonly string[]>;
}

interface SectionMember {
  readonly id: string;
  readonly declarationIndex: number;
}

interface SectionEdge {
  readonly from: string;
  readonly to: string;
}

interface MutableSectionGraph {
  readonly members: Map<string, SectionMember>;
  readonly edges: SectionEdge[];
}

interface MutableTabSectionsInput {
  readonly graph: MutableSectionGraph;
  readonly groups: MutableGroupRecord[];
  readonly comments: CommentRecord[];
  readonly memberIdsByGroupId: Map<string, string[]>;
}

interface MutableGroupRecord {
  readonly id: string;
  readonly explicitKey: string;
  readonly name: string;
  readonly declarationIndex: number;
  readonly memberIds: string[];
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
}

interface CommentRecord {
  readonly id: string;
  readonly text: string;
  readonly declarationIndex: number;
  readonly hasMembership: boolean;
  readonly explicitHeaderFor?: string;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
}

interface BaseSection {
  readonly id: string;
  readonly memberIds: readonly string[];
  readonly minDeclarationIndex: number;
}

function emptyMutableGraph(): MutableSectionGraph {
  return { members: new Map(), edges: [] };
}

function emptyMutableInput(): MutableTabSectionsInput {
  return { graph: emptyMutableGraph(), groups: [], comments: [], memberIdsByGroupId: new Map() };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareMembers(a: SectionMember, b: SectionMember): number {
  if (a.declarationIndex !== b.declarationIndex) {
    return a.declarationIndex - b.declarationIndex;
  }
  return compareString(a.id, b.id);
}

function compareMemberIds(
  members: ReadonlyMap<string, SectionMember>,
  a: string,
  b: string,
): number {
  const aMember = members.get(a);
  const bMember = members.get(b);
  if (aMember !== undefined && bMember !== undefined) return compareMembers(aMember, bMember);
  if (aMember !== undefined) return -1;
  if (bMember !== undefined) return 1;
  return compareString(a, b);
}

function addGraphMember(graph: MutableSectionGraph, id: string, declarationIndex: number): void {
  if (graph.members.has(id)) return;
  graph.members.set(id, { id, declarationIndex });
}

function addGroupMember(input: MutableTabSectionsInput, groupId: string, memberId: string): void {
  const existing = input.memberIdsByGroupId.get(groupId);
  if (existing === undefined) input.memberIdsByGroupId.set(groupId, [memberId]);
  else existing.push(memberId);
}

function zOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function rowsOf(node: FlowsJsonNode): readonly (readonly string[])[] {
  const wires = (node as { wires?: unknown }).wires;
  if (!Array.isArray(wires)) return [];
  const rows: string[][] = [];
  for (const row of wires) {
    if (!Array.isArray(row)) continue;
    rows.push(row.filter((target): target is string => typeof target === 'string'));
  }
  return rows;
}

function graphForTab(
  tabs: Map<string, MutableTabSectionsInput>,
  tabId: string,
): MutableTabSectionsInput {
  const existing = tabs.get(tabId);
  if (existing !== undefined) return existing;
  const created = emptyMutableInput();
  tabs.set(tabId, created);
  return created;
}

function explicitHeaderForOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record['_authoringHeaderFor'] === 'string') return record['_authoringHeaderFor'];
  if (typeof record['headerFor'] === 'string') return record['headerFor'];
  return undefined;
}

function authoringKeyOf(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const key = (value as Record<string, unknown>)['_authoringKey'];
  return typeof key === 'string' ? key : fallback;
}

function flowGroupRecord(group: FlowsJsonNode, declarationIndex: number): MutableGroupRecord {
  const name = (group as { name?: unknown }).name;
  const x = (group as { x?: unknown }).x;
  const y = (group as { y?: unknown }).y;
  const w = (group as { w?: unknown }).w;
  const h = (group as { h?: unknown }).h;
  const nodes = (group as { nodes?: unknown }).nodes;
  const memberIds = Array.isArray(nodes)
    ? nodes.filter((id): id is string => typeof id === 'string')
    : [];

  return {
    id: group.id,
    explicitKey: authoringKeyOf(group, group.id),
    name: typeof name === 'string' ? name : '',
    declarationIndex,
    memberIds,
    ...(finiteNumber(x) ? { x } : {}),
    ...(finiteNumber(y) ? { y } : {}),
    ...(finiteNumber(w) ? { w } : {}),
    ...(finiteNumber(h) ? { h } : {}),
  };
}

function flowCommentRecord(comment: FlowsJsonNode, declarationIndex: number): CommentRecord {
  const name = (comment as { name?: unknown }).name;
  const x = (comment as { x?: unknown }).x;
  const y = (comment as { y?: unknown }).y;
  const w = (comment as { w?: unknown }).w;
  const h = (comment as { h?: unknown }).h;
  const g = (comment as { g?: unknown }).g;
  const explicitHeaderFor = explicitHeaderForOf(comment);

  return {
    id: comment.id,
    text: typeof name === 'string' ? name : '',
    declarationIndex,
    hasMembership: typeof g === 'string',
    ...(explicitHeaderFor !== undefined ? { explicitHeaderFor } : {}),
    ...(finiteNumber(x) ? { x } : {}),
    ...(finiteNumber(y) ? { y } : {}),
    ...(finiteNumber(w) ? { w } : {}),
    ...(finiteNumber(h) ? { h } : {}),
  };
}

function tabGroupRecord(group: GroupSpec, declarationIndex: number): MutableGroupRecord {
  return {
    id: group.key,
    explicitKey: group.key,
    name: group.name,
    declarationIndex,
    memberIds: [...group.nodeKeys],
    ...(finiteNumber(group.position?.x) ? { x: group.position.x } : {}),
    ...(finiteNumber(group.position?.y) ? { y: group.position.y } : {}),
    ...(finiteNumber(group.size?.w) ? { w: group.size.w } : {}),
    ...(finiteNumber(group.size?.h) ? { h: group.size.h } : {}),
  };
}

function tabCommentRecord(comment: CommentSpec, declarationIndex: number): CommentRecord {
  const g = (comment as { g?: unknown }).g;
  const explicitHeaderFor = explicitHeaderForOf(comment);
  return {
    id: comment.key,
    text: comment.text,
    declarationIndex,
    hasMembership: comment.groupKey !== undefined || typeof g === 'string',
    ...(explicitHeaderFor !== undefined ? { explicitHeaderFor } : {}),
    x: comment.position.x,
    y: comment.position.y,
    ...(finiteNumber(comment.size?.w) ? { w: comment.size.w } : {}),
    ...(finiteNumber(comment.size?.h) ? { h: comment.size.h } : {}),
  };
}

function adjacencyOf(graph: MutableSectionGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const id of graph.members.keys()) adjacency.set(id, []);
  for (const edge of graph.edges) {
    if (!graph.members.has(edge.from) || !graph.members.has(edge.to)) continue;
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((a, b) => compareMemberIds(graph.members, a, b));
  }
  return adjacency;
}

function baseSectionsOf(graph: MutableSectionGraph): {
  readonly sections: readonly BaseSection[];
  readonly sectionIdByMemberId: ReadonlyMap<string, string>;
} {
  const adjacency = adjacencyOf(graph);
  const orderedMembers = [...graph.members.values()].sort(compareMembers);
  const visited = new Set<string>();
  const sectionIdByMemberId = new Map<string, string>();
  const sections: BaseSection[] = [];

  for (const start of orderedMembers) {
    if (visited.has(start.id)) continue;
    const componentIds: string[] = [];
    const queue = [start.id];
    visited.add(start.id);

    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      componentIds.push(id);
      for (const next of adjacency.get(id) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }

    componentIds.sort((a, b) => compareMemberIds(graph.members, a, b));
    const firstId = componentIds[0]!;
    const firstMember = graph.members.get(firstId)!;
    for (const id of componentIds) sectionIdByMemberId.set(id, firstId);
    sections.push({
      id: firstId,
      memberIds: componentIds,
      minDeclarationIndex: firstMember.declarationIndex,
    });
  }

  sections.sort((a, b) => {
    if (a.minDeclarationIndex !== b.minDeclarationIndex) {
      return a.minDeclarationIndex - b.minDeclarationIndex;
    }
    return compareString(a.id, b.id);
  });
  return { sections, sectionIdByMemberId };
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [value]);
    return;
  }
  if (!existing.includes(value)) existing.push(value);
}

function readonlyArrayMap(
  map: ReadonlyMap<string, readonly string[]>,
): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const [key, values] of map) out.set(key, [...values]);
  return out;
}

function sectionIndexMap(sections: readonly BaseSection[]): Map<string, number> {
  const indexes = new Map<string, number>();
  for (let i = 0; i < sections.length; i++) indexes.set(sections[i]!.id, i);
  return indexes;
}

function compareSectionIds(indexes: ReadonlyMap<string, number>, a: string, b: string): number {
  const aIndex = indexes.get(a) ?? Number.MAX_SAFE_INTEGER;
  const bIndex = indexes.get(b) ?? Number.MAX_SAFE_INTEGER;
  if (aIndex !== bIndex) return aIndex - bIndex;
  return compareString(a, b);
}

function groupMemberIds(group: MutableGroupRecord, input: MutableTabSectionsInput): string[] {
  return uniqueStrings([...group.memberIds, ...(input.memberIdsByGroupId.get(group.id) ?? [])]);
}

function deriveGroupSections(
  input: MutableTabSectionsInput,
  baseSections: readonly BaseSection[],
  sectionIdByMemberId: ReadonlyMap<string, string>,
): {
  readonly sectionIdsByGroupId: ReadonlyMap<string, readonly string[]>;
  readonly groupIdsBySectionId: ReadonlyMap<string, readonly string[]>;
} {
  const sectionIndexes = sectionIndexMap(baseSections);
  const sectionIdsByGroupId = new Map<string, readonly string[]>();
  const groupIdsBySectionId = new Map<string, string[]>();
  const groups = [...input.groups].sort((a, b) => {
    if (a.declarationIndex !== b.declarationIndex) return a.declarationIndex - b.declarationIndex;
    return compareString(a.id, b.id);
  });

  for (const group of groups) {
    const sectionIds = uniqueStrings(
      groupMemberIds(group, input)
        .map((memberId) => sectionIdByMemberId.get(memberId))
        .filter((sectionId): sectionId is string => sectionId !== undefined),
    ).sort((a, b) => compareSectionIds(sectionIndexes, a, b));
    sectionIdsByGroupId.set(group.id, sectionIds);
    for (const sectionId of sectionIds) pushUnique(groupIdsBySectionId, sectionId, group.id);
  }

  return { sectionIdsByGroupId, groupIdsBySectionId: readonlyArrayMap(groupIdsBySectionId) };
}

function explicitHeaderLookup(groups: readonly MutableGroupRecord[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const group of groups) {
    if (!lookup.has(group.explicitKey)) lookup.set(group.explicitKey, group.id);
  }
  return lookup;
}

function heuristicHeaderGroupId(
  comment: CommentRecord,
  groups: readonly MutableGroupRecord[],
): string | undefined {
  if (!finiteNumber(comment.x) || !finiteNumber(comment.y)) return undefined;
  let best: { readonly group: MutableGroupRecord; readonly gap: number } | undefined;

  for (const group of groups) {
    if (!finiteNumber(group.x) || !finiteNumber(group.y) || !finiteNumber(group.w)) continue;
    if (group.name.trim() === '' || !comment.text.startsWith(group.name)) continue;

    const gap = group.y - comment.y;
    if (!(gap > 0 && gap <= HEADER_VERTICAL_GAP)) continue;

    const x1 = Math.min(group.x, group.x + group.w);
    const x2 = Math.max(group.x, group.x + group.w);
    if (comment.x < x1 || comment.x > x2) continue;

    if (
      best === undefined ||
      gap < best.gap ||
      (gap === best.gap &&
        (group.declarationIndex < best.group.declarationIndex ||
          (group.declarationIndex === best.group.declarationIndex &&
            compareString(group.id, best.group.id) < 0)))
    ) {
      best = { group, gap };
    }
  }

  return best?.group.id;
}

function deriveHeaders(
  input: MutableTabSectionsInput,
  sectionIdsByGroupId: ReadonlyMap<string, readonly string[]>,
): {
  readonly headerGroupIdByCommentId: ReadonlyMap<string, string>;
  readonly headerCommentIdsByGroupId: ReadonlyMap<string, readonly string[]>;
  readonly headerCommentIdsBySectionId: ReadonlyMap<string, readonly string[]>;
} {
  const groups = [...input.groups].sort((a, b) => {
    if (a.declarationIndex !== b.declarationIndex) return a.declarationIndex - b.declarationIndex;
    return compareString(a.id, b.id);
  });
  const comments = [...input.comments].sort((a, b) => {
    if (a.declarationIndex !== b.declarationIndex) return a.declarationIndex - b.declarationIndex;
    return compareString(a.id, b.id);
  });
  const explicit = explicitHeaderLookup(groups);
  const headerGroupIdByCommentId = new Map<string, string>();
  const headerCommentIdsByGroupId = new Map<string, string[]>();
  const headerCommentIdsBySectionId = new Map<string, string[]>();

  for (const comment of comments) {
    if (comment.hasMembership) continue;
    const explicitGroupId =
      comment.explicitHeaderFor !== undefined ? explicit.get(comment.explicitHeaderFor) : undefined;
    const groupId = explicitGroupId ?? heuristicHeaderGroupId(comment, groups);
    if (groupId === undefined) continue;

    headerGroupIdByCommentId.set(comment.id, groupId);
    pushUnique(headerCommentIdsByGroupId, groupId, comment.id);
    for (const sectionId of sectionIdsByGroupId.get(groupId) ?? []) {
      pushUnique(headerCommentIdsBySectionId, sectionId, comment.id);
    }
  }

  return {
    headerGroupIdByCommentId,
    headerCommentIdsByGroupId: readonlyArrayMap(headerCommentIdsByGroupId),
    headerCommentIdsBySectionId: readonlyArrayMap(headerCommentIdsBySectionId),
  };
}

function deriveSections(input: MutableTabSectionsInput): SectionDerivation {
  const { sections: baseSections, sectionIdByMemberId } = baseSectionsOf(input.graph);
  const { sectionIdsByGroupId, groupIdsBySectionId } = deriveGroupSections(
    input,
    baseSections,
    sectionIdByMemberId,
  );
  const { headerGroupIdByCommentId, headerCommentIdsByGroupId, headerCommentIdsBySectionId } =
    deriveHeaders(input, sectionIdsByGroupId);
  const sections: Section[] = baseSections.map((section) => ({
    ...section,
    groupIds: groupIdsBySectionId.get(section.id) ?? [],
    headerCommentIds: headerCommentIdsBySectionId.get(section.id) ?? [],
  }));

  return {
    sections,
    sectionIdByMemberId,
    sectionIdsByGroupId,
    headerGroupIdByCommentId,
    headerCommentIdsByGroupId,
  };
}

export function deriveTabSpecSections(tab: TabSpec): SectionDerivation {
  const input = emptyMutableInput();

  for (let i = 0; i < tab.nodes.length; i++) {
    const node = tab.nodes[i]!;
    addGraphMember(input.graph, node.key, i);
    if (node.groupKey !== undefined) addGroupMember(input, node.groupKey, node.key);
  }

  const junctions = tab.junctions ?? [];
  for (let i = 0; i < junctions.length; i++) {
    const junction = junctions[i]!;
    addGraphMember(input.graph, junction.key, tab.nodes.length + i);
    if (junction.groupKey !== undefined) addGroupMember(input, junction.groupKey, junction.key);
  }

  for (const connection of tab.connections) {
    if (input.graph.members.has(connection.fromKey) && input.graph.members.has(connection.toKey)) {
      input.graph.edges.push({ from: connection.fromKey, to: connection.toKey });
    }
  }

  for (let i = 0; i < tab.groups.length; i++) {
    input.groups.push(tabGroupRecord(tab.groups[i]!, i));
  }
  for (let i = 0; i < tab.comments.length; i++) {
    input.comments.push(tabCommentRecord(tab.comments[i]!, i));
  }

  return deriveSections(input);
}

export function deriveFlowsJsonSections(flows: FlowsJson): ReadonlyMap<string, SectionDerivation> {
  const tabs = new Map<string, MutableTabSectionsInput>();
  const configIds = configByReferenceIds(flows);

  for (let i = 0; i < flows.length; i++) {
    const node = flows[i]!;
    if (isTab(node)) {
      graphForTab(tabs, node.id);
      continue;
    }

    const tabId = zOf(node);
    if (tabId === undefined) continue;

    if (isGroup(node)) {
      graphForTab(tabs, tabId).groups.push(flowGroupRecord(node, i));
      continue;
    }

    if (isComment(node)) {
      graphForTab(tabs, tabId).comments.push(flowCommentRecord(node, i));
      continue;
    }

    if (!hasCanvasPosition(node)) continue;
    if (isConfigShapedNode(node, configIds)) continue;
    if (!isRegularNode(node) && !isJunction(node)) continue;

    const input = graphForTab(tabs, tabId);
    addGraphMember(input.graph, node.id, i);
    const groupId = (node as { g?: unknown }).g;
    if (typeof groupId === 'string') addGroupMember(input, groupId, node.id);
  }

  for (const node of flows) {
    if (!hasCanvasPosition(node)) continue;
    const tabId = zOf(node);
    if (tabId === undefined) continue;
    const input = tabs.get(tabId);
    if (input === undefined || !input.graph.members.has(node.id)) continue;
    const rows = isJunction(node) ? rowsOf(node).slice(0, 1) : rowsOf(node);
    for (const row of rows) {
      for (const target of row) {
        if (input.graph.members.has(target)) input.graph.edges.push({ from: node.id, to: target });
      }
    }
  }

  const result = new Map<string, SectionDerivation>();
  for (const [tabId, input] of tabs) result.set(tabId, deriveSections(input));
  return result;
}
