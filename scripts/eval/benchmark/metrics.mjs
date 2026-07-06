/**
 * EVAL-4-skeleton — pure S6 metric helpers (fix plan §3 EVAL-4).
 *
 * These are the audit e4-probe helpers promoted into repo code without I/O:
 * strip layout placement from a decompiled FlowSpec, and compute raw
 * Node-RED flow metrics used by the future scored S6 runner. Junction
 * coordinates are kept-but-zeroed because PROTOCOL.md treats them as wiring
 * waypoints, not layout preference.
 */

export function stripPositions(spec) {
  return {
    ...spec,
    tabs: spec.tabs.map((tab) => ({
      ...tab,
      nodes: tab.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
      comments: tab.comments.map((c) => ({ ...c, position: { x: 0, y: 0 } })),
      groups: tab.groups.map(({ position: _position, size: _size, ...rest }) => rest),
      ...(tab.junctions
        ? { junctions: tab.junctions.map((j) => ({ ...j, position: { x: 0, y: 0 } })) }
        : {}),
    })),
  };
}

export function flowMetrics(flows, tabId) {
  const members = flows.filter((n) => n.z === tabId);
  const pos = new Map();
  for (const n of members) {
    if (typeof n.x === 'number' && typeof n.y === 'number') {
      pos.set(n.id, { x: n.x, y: n.y });
    }
  }

  const edges = [];
  for (const n of members) {
    if (!Array.isArray(n.wires)) continue;
    for (const port of n.wires) {
      for (const t of port ?? []) {
        if (pos.has(n.id) && pos.has(t)) edges.push([n.id, t]);
      }
    }
  }

  let backward = 0;
  for (const [a, b] of edges) {
    if (pos.get(b).x < pos.get(a).x) backward++;
  }

  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a1, b1] = edges[i];
      const [a2, b2] = edges[j];
      if (a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2) continue;
      const p1 = pos.get(a1);
      const p2 = pos.get(b1);
      const p3 = pos.get(a2);
      const p4 = pos.get(b2);
      const d1 = cross(p3, p4, p1);
      const d2 = cross(p3, p4, p2);
      const d3 = cross(p1, p2, p3);
      const d4 = cross(p1, p2, p4);
      if (
        ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
      ) {
        crossings++;
      }
    }
  }

  if (pos.size === 0) {
    return {
      nodes: 0,
      wires: edges.length,
      backwardWires: backward,
      straightLineCrossings: crossings,
      extent: { w: 0, h: 0 },
    };
  }

  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  return {
    nodes: pos.size,
    wires: edges.length,
    backwardWires: backward,
    straightLineCrossings: crossings,
    extent: { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
  };
}
