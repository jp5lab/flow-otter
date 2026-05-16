import type {
  CommentSpec,
  ConnectionSpec,
  GroupSpec,
  NodeSpec,
  Position,
  TabSpec,
} from './types.js';

interface TabBuilderOpts {
  id: string;
  label: string;
  disabled?: boolean;
  info?: string;
  nodes?: readonly NodeSpec[];
  connections?: readonly ConnectionSpec[];
  groups?: readonly GroupSpec[];
  comments?: readonly CommentSpec[];
}

export function tab(opts: TabBuilderOpts): TabSpec {
  return {
    id: opts.id,
    label: opts.label,
    ...(opts.disabled !== undefined ? { disabled: opts.disabled } : {}),
    ...(opts.info !== undefined ? { info: opts.info } : {}),
    nodes: opts.nodes ?? [],
    connections: opts.connections ?? [],
    groups: opts.groups ?? [],
    comments: opts.comments ?? [],
  };
}

interface NodeBuilderOpts {
  key: string;
  label?: string;
  position: Position;
  groupKey?: string;
  passthrough?: Readonly<Record<string, unknown>>;
}

function buildNode(type: string, opts: NodeBuilderOpts): NodeSpec {
  return {
    key: opts.key,
    type,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    position: opts.position,
    ...(opts.groupKey !== undefined ? { groupKey: opts.groupKey } : {}),
    ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
  };
}

export function inject(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('inject', opts);
}

export function debug(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('debug', opts);
}

export function fnNode(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('function', opts);
}

export function genericNode(type: string, opts: NodeBuilderOpts): NodeSpec {
  return buildNode(type, opts);
}

export function mqttIn(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('mqtt in', opts);
}
export function mqttOut(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('mqtt out', opts);
}
export function linkIn(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('link in', opts);
}
export function linkOut(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('link out', opts);
}
export function linkCall(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('link call', opts);
}
export function catchNode(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('catch', opts);
}
export function statusNode(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('status', opts);
}
export function completeNode(opts: NodeBuilderOpts): NodeSpec {
  return buildNode('complete', opts);
}

export function subflowInstance(defId: string, opts: NodeBuilderOpts): NodeSpec {
  return buildNode(`subflow:${defId}`, opts);
}

interface GroupBuilderOpts {
  key: string;
  name: string;
  nodeKeys: readonly string[];
  style?: Readonly<Record<string, unknown>>;
}

export function group(opts: GroupBuilderOpts): GroupSpec {
  return {
    key: opts.key,
    name: opts.name,
    nodeKeys: opts.nodeKeys,
    ...(opts.style !== undefined ? { style: opts.style } : {}),
  };
}

interface CommentBuilderOpts {
  key: string;
  text: string;
  position: Position;
  info?: string;
  groupKey?: string;
}

export function comment(opts: CommentBuilderOpts): CommentSpec {
  return {
    key: opts.key,
    text: opts.text,
    position: opts.position,
    ...(opts.info !== undefined ? { info: opts.info } : {}),
    ...(opts.groupKey !== undefined ? { groupKey: opts.groupKey } : {}),
  };
}

export function connect(fromKey: string, toKey: string, outputPort = 0): ConnectionSpec {
  return { fromKey, outputPort, toKey };
}
