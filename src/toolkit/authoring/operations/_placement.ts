import type { PlacementArea } from '../../layout/placement.js';
import { editorGeometryProvider, type NodeDimensions } from '../../render/metrics.js';
import type { CommentSpec, TabSpec } from '../types.js';
import { getInputPortCount, getOutputPortCount, isNodeLabelHidden } from '../types.js';

const JUNCTION_SIZE = 10;

export interface NodePlacementShape {
  readonly type: string;
  readonly label?: string;
  readonly passthrough?: Readonly<Record<string, unknown>>;
}

function labelFor(shape: NodePlacementShape): string {
  return shape.label ?? shape.type;
}

export function nodePlacementDimensions(shape: NodePlacementShape): NodeDimensions {
  const passthrough = shape.passthrough;
  return editorGeometryProvider.nodeDimensionsFor(labelFor(shape), {
    inputs: getInputPortCount(shape.type, passthrough),
    outputs: getOutputPortCount(shape.type, passthrough),
    hideLabel: isNodeLabelHidden(shape.type, passthrough),
  });
}

function commentPlacementArea(comment: CommentSpec): PlacementArea {
  const measured = editorGeometryProvider.nodeDimensionsFor(comment.text, {
    inputs: 0,
    outputs: 0,
  });
  const size = comment.size ?? measured;
  return { position: comment.position, width: size.w, height: size.h };
}

export function placementAreasForTab(tab: TabSpec): PlacementArea[] {
  const areas: PlacementArea[] = [];
  for (const node of tab.nodes) {
    const dims = nodePlacementDimensions(node);
    areas.push({ position: node.position, width: dims.w, height: dims.h });
  }
  for (const junction of tab.junctions ?? []) {
    areas.push({ position: junction.position, width: JUNCTION_SIZE, height: JUNCTION_SIZE });
  }
  for (const comment of tab.comments) areas.push(commentPlacementArea(comment));
  for (const group of tab.groups) {
    if (group.position === undefined || group.size === undefined) continue;
    areas.push({
      position: group.position,
      width: group.size.w,
      height: group.size.h,
      anchor: 'topLeft',
    });
  }
  return areas;
}

export function fallbackPlacementDimensions(): NodeDimensions {
  return editorGeometryProvider.nodeDimensionsFor('', {});
}
