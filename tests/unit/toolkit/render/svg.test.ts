/**
 * Renderer geometry tests (REND-3).
 *
 * ── RE-BLESS PROTOCOL (binding; fix-plan risk register #3) ─────────────────
 * The blessed SVG snapshots under __snapshots__/ may ONLY be re-blessed in a
 * commit that also adds/updates an assertion test in this file NAMING the
 * geometry the re-bless changes. Snapshots pin "nothing changed by
 * accident"; the named assertions below pin "the geometry is editor-true"
 * and MUST survive any re-bless — they are deliberately independent of the
 * snapshot files. Never re-bless to silence a failing assertion.
 *
 * Named assertions (fix-plan REND-3 (a)-(f), audit F2/F3/F6/e2#11/e1#9):
 *   (a) e1 switch 3865da1cf3821d01 renders exactly 2 output ports
 *   (b) no <rect> for the e1 mqtt-broker id (config-by-reference exclusion)
 *   (c) junction renders as a circle with its outgoing wire path
 *   (d) group containment (e1: every member box inside its group bbox)
 *   (e) node at (0,0) is fully visible (whole-body translate)
 *   (f) wire endpoints equal port coordinates
 * plus: multi-output heights from nodeDimensionsFor, and the renderGeometry
 * frozen-contract shape (center-convention, post-translate, SVG-coordinate
 * equality).
 *
 * 2026-06-10 re-bless: all 5 snapshots re-blessed for REND-3's center
 * anchors, editor-true heights, per-port-count output anchors, input ports
 * only when the type has inputs, junction waypoints, and config-node
 * exclusion — each named by the assertions above.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../../../src/shared/flows-json.js';
import { nodeDimensionsFor } from '../../../../src/toolkit/render/metrics.js';
import {
  renderGeometry,
  renderSvg,
  type RenderGeometryEntry,
} from '../../../../src/toolkit/render/svg.js';

const FIXTURE_EMPTY: FlowsJson = [{ id: 'tab1', type: 'tab', label: 'Empty' }];

const FIXTURE_INJECT_TO_DEBUG: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'Pipeline' },
  {
    id: 'aaaaaaaaaaaaaaaa',
    type: 'inject',
    z: 'tab1',
    x: 80,
    y: 80,
    wires: [['bbbbbbbbbbbbbbbb']],
    name: 'In',
  },
  {
    id: 'bbbbbbbbbbbbbbbb',
    type: 'debug',
    z: 'tab1',
    x: 240,
    y: 80,
    wires: [],
    name: 'Out',
  },
];

const FIXTURE_FUNCTION_THREE_OUTPUTS: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'Fan' },
  {
    id: 'aaaaaaaaaaaaaaaa',
    type: 'inject',
    z: 'tab1',
    x: 80,
    y: 100,
    wires: [['bbbbbbbbbbbbbbbb']],
    name: 'Trigger',
  },
  {
    id: 'bbbbbbbbbbbbbbbb',
    type: 'function',
    z: 'tab1',
    x: 240,
    y: 100,
    wires: [['cccccccccccccccc'], ['dddddddddddddddd'], ['eeeeeeeeeeeeeeee']],
    name: 'Fan',
    func: 'return msg;',
    outputs: 3,
  },
  {
    id: 'cccccccccccccccc',
    type: 'debug',
    z: 'tab1',
    x: 420,
    y: 60,
    wires: [],
    name: 'D1',
  },
  {
    id: 'dddddddddddddddd',
    type: 'debug',
    z: 'tab1',
    x: 420,
    y: 100,
    wires: [],
    name: 'D2',
  },
  {
    id: 'eeeeeeeeeeeeeeee',
    type: 'debug',
    z: 'tab1',
    x: 420,
    y: 140,
    wires: [],
    name: 'D3',
  },
];

const FIXTURE_TWO_TABS_ALL: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'TabOne' },
  {
    id: 'aaaaaaaaaaaaaaaa',
    type: 'inject',
    z: 'tab1',
    x: 80,
    y: 80,
    wires: [['bbbbbbbbbbbbbbbb']],
    name: 'A',
  },
  {
    id: 'bbbbbbbbbbbbbbbb',
    type: 'debug',
    z: 'tab1',
    x: 240,
    y: 80,
    wires: [],
    name: 'B',
  },
  { id: 'tab2', type: 'tab', label: 'TabTwo' },
  {
    id: 'cccccccccccccccc',
    type: 'inject',
    z: 'tab2',
    x: 80,
    y: 80,
    wires: [['dddddddddddddddd']],
    name: 'C',
  },
  {
    id: 'dddddddddddddddd',
    type: 'debug',
    z: 'tab2',
    x: 240,
    y: 80,
    wires: [],
    name: 'D',
  },
];

const FIXTURE_GROUP_COMMENT_LONG_LABEL: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'GroupTab' },
  {
    id: 'gggggggggggggggg',
    type: 'group',
    z: 'tab1',
    x: 60,
    y: 60,
    w: 280,
    h: 100,
    name: 'Group A',
    nodes: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'],
  },
  {
    id: 'cccccccccccccccc',
    type: 'comment',
    z: 'tab1',
    x: 60,
    y: 200,
    name: 'A note',
  },
  {
    id: 'aaaaaaaaaaaaaaaa',
    type: 'inject',
    z: 'tab1',
    x: 100,
    y: 100,
    wires: [['bbbbbbbbbbbbbbbb']],
    g: 'gggggggggggggggg',
    name: 'In',
  },
  {
    id: 'bbbbbbbbbbbbbbbb',
    type: 'function',
    z: 'tab1',
    x: 200,
    y: 100,
    wires: [],
    g: 'gggggggggggggggg',
    name: 'this is a deliberately long label that should be truncated',
    func: 'return msg;',
  },
];

/** inject → junction → debug: the F6/e2#11 junction wire-walk shape. */
const FIXTURE_JUNCTION: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'Junction' },
  {
    id: 'aaaaaaaaaaaaaaaa',
    type: 'inject',
    z: 'tab1',
    x: 100,
    y: 100,
    wires: [['jjjjjjjjjjjjjjjj']],
    name: 'In',
  },
  {
    id: 'jjjjjjjjjjjjjjjj',
    type: 'junction',
    z: 'tab1',
    x: 200,
    y: 100,
    wires: [['bbbbbbbbbbbbbbbb']],
  },
  {
    id: 'bbbbbbbbbbbbbbbb',
    type: 'debug',
    z: 'tab1',
    x: 300,
    y: 100,
    wires: [],
    name: 'Sink',
  },
];

interface E1Fixture {
  flows: FlowsJson;
  rev: string;
}

function loadE1(): E1Fixture {
  const path = fileURLToPath(
    new URL('../../../fixtures/audit-2026-06-10/e1-flows.json', import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as E1Fixture;
}

function loadSnapshot(name: string): string {
  const path = fileURLToPath(new URL(`./__snapshots__/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

const E1_TAB = 'f6f2187d.f17ca8';
const E1_SWITCH = '3865da1cf3821d01';
const E1_BROKER = '987eef4ff5597e9c';

function entryById(entries: RenderGeometryEntry[], id: string): RenderGeometryEntry {
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no geometry entry for ${id}`);
  return entry;
}

/** Parses every wire path into its start and end points. */
function parseWireEndpoints(svg: string): Array<{ from: [number, number]; to: [number, number] }> {
  const out: Array<{ from: [number, number]; to: [number, number] }> = [];
  const re = /<path d="M (-?[\d.]+) (-?[\d.]+) C [^"]*, (-?[\d.]+) (-?[\d.]+)"/g;
  for (const m of svg.matchAll(re)) {
    out.push({
      from: [Number(m[1]), Number(m[2])],
      to: [Number(m[3]), Number(m[4])],
    });
  }
  return out;
}

describe('renderSvg', () => {
  it('renders fixture empty', async () => {
    const svg = renderSvg(FIXTURE_EMPTY, { tabId: 'tab1' });
    await expect(svg).toMatchFileSnapshot('./__snapshots__/empty.svg');
  });

  it('renders fixture inject_to_debug', async () => {
    const svg = renderSvg(FIXTURE_INJECT_TO_DEBUG, { tabId: 'tab1' });
    await expect(svg).toMatchFileSnapshot('./__snapshots__/inject_to_debug.svg');
  });

  it('renders fixture function_three_outputs', async () => {
    const svg = renderSvg(FIXTURE_FUNCTION_THREE_OUTPUTS, { tabId: 'tab1' });
    await expect(svg).toMatchFileSnapshot('./__snapshots__/function_three_outputs.svg');
  });

  it('renders fixture two_tabs_all', async () => {
    const svg = renderSvg(FIXTURE_TWO_TABS_ALL, { allTabs: true });
    await expect(svg).toMatchFileSnapshot('./__snapshots__/two_tabs_all.svg');
  });

  it('renders fixture group_comment_long_label', async () => {
    const svg = renderSvg(FIXTURE_GROUP_COMMENT_LONG_LABEL, { tabId: 'tab1' });
    await expect(svg).toMatchFileSnapshot('./__snapshots__/group_comment_long_label.svg');
  });

  it('escapes XML special characters in labels', () => {
    const flows: FlowsJson = [
      { id: 'tab1', type: 'tab', label: 'Tab' },
      {
        id: 'aaaaaaaaaaaaaaaa',
        type: 'inject',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [],
        name: '<bad>&',
      },
    ];
    const svg = renderSvg(flows, { tabId: 'tab1' });
    expect(svg).toContain('&lt;bad&gt;&amp;');
    expect(svg).not.toContain('<bad>&');
  });

  it('produces byte-identical SVG across runs for every fixture', () => {
    for (const flows of [
      FIXTURE_INJECT_TO_DEBUG,
      FIXTURE_FUNCTION_THREE_OUTPUTS,
      FIXTURE_GROUP_COMMENT_LONG_LABEL,
      FIXTURE_JUNCTION,
    ]) {
      expect(renderSvg(flows, { tabId: 'tab1' })).toBe(renderSvg(flows, { tabId: 'tab1' }));
    }
  });

  it('keeps no-option rendering byte-identical to the existing snapshot', () => {
    expect(renderSvg(FIXTURE_INJECT_TO_DEBUG, { tabId: 'tab1' })).toBe(
      loadSnapshot('inject_to_debug.svg'),
    );
  });

  it('fills non-installed node types with the editor unknown-node color when installedTypes is set', () => {
    const flows: FlowsJson = [
      { id: 'tab1', type: 'tab', label: 'Unknowns' },
      {
        id: 'known1',
        type: 'inject',
        z: 'tab1',
        x: 100,
        y: 100,
        wires: [['missing1']],
        name: 'Known',
      },
      {
        id: 'unknown1',
        type: 'node-red-contrib-missing',
        z: 'tab1',
        x: 260,
        y: 100,
        wires: [],
        name: 'Missing',
      },
    ];

    const svg = renderSvg(flows, { tabId: 'tab1', installedTypes: ['inject', 'debug'] });
    expect(svg.match(/fill="#fee"/g)).toHaveLength(1);
    expect(svg).toContain(
      '<rect x="200" y="85" width="120" height="30" rx="4" ry="4" fill="#fee" stroke="#888888" stroke-width="1"/>',
    );
    expect(svg).toContain('fill="#a6bbcf"');
  });

  it('does not flag subflow instances as unknown when their definition exists', () => {
    const flows: FlowsJson = [
      { id: 'tab1', type: 'tab', label: 'Subflow' },
      { id: 'sub1', type: 'subflow', name: 'Sub', in: [{ wires: [] }], out: [{ wires: [] }] },
      {
        id: 'inst1',
        type: 'subflow:sub1',
        z: 'tab1',
        x: 100,
        y: 100,
        wires: [[]],
        name: 'Sub instance',
      },
    ];

    const svg = renderSvg(flows, { tabId: 'tab1', installedTypes: [] });
    expect(svg).not.toContain('fill="#fee"');
    expect(svg).toContain('fill="#dddddd"');
  });

  it('draws a deterministic group info badge only for groups with non-empty info', () => {
    const flows: FlowsJson = [
      { id: 'tab1', type: 'tab', label: 'Groups' },
      {
        id: 'group-info',
        type: 'group',
        z: 'tab1',
        x: 40,
        y: 40,
        w: 220,
        h: 100,
        name: 'Documented',
        nodes: [],
        info: 'Purpose text',
      },
      {
        id: 'group-empty',
        type: 'group',
        z: 'tab1',
        x: 300,
        y: 40,
        w: 220,
        h: 100,
        name: 'Plain',
        nodes: [],
      },
    ];

    const svg = renderSvg(flows, { tabId: 'tab1' });
    expect(svg.match(/data-flowotter-info-badge=/g)).toHaveLength(1);
    expect(svg).toContain('data-flowotter-info-badge="group-info"');
    expect(svg).not.toContain('data-flowotter-info-badge="group-empty"');
  });
});

describe('renderer geometry assertions (a)-(f) — survive any snapshot re-bless', () => {
  const { flows: e1 } = loadE1();

  it('(a) e1 switch 3865da1cf3821d01 renders exactly 2 output ports at editor anchors (F3)', () => {
    const entries = renderGeometry(e1, E1_TAB);
    const sw = entryById(entries, E1_SWITCH);
    const outs = sw.ports.filter((p) => p.kind === 'output');
    expect(outs).toHaveLength(2);
    // 'T >= 80 degC?' → w 160, center (940, 260): right edge 1020, port
    // centers 13px apart symmetric about cy (the 2-output fixture row).
    expect(sw.w).toBe(160);
    expect(outs.map((p) => [p.x, p.y])).toEqual([
      [1020, 253.5],
      [1020, 266.5],
    ]);
    const svg = renderSvg(e1, { tabId: E1_TAB });
    expect(svg).toContain('<circle cx="1020" cy="253.50"');
    expect(svg).toContain('<circle cx="1020" cy="266.50"');
    // Exactly the two port circles sit on the switch's right edge.
    expect(svg.match(/<circle cx="1020" /g)).toHaveLength(2);
  });

  it('(b) the e1 mqtt-broker renders no <rect> — config-by-reference exclusion (e1#9)', () => {
    const entries = renderGeometry(e1, E1_TAB);
    expect(entries.some((e) => e.id === E1_BROKER)).toBe(false);
    const svg = renderSvg(e1, { tabId: E1_TAB });
    expect(svg).not.toContain('mosquitto-local');
    // background + 6 groups + 6 comments + 14 visual nodes = 27 rects; a
    // rendered broker would make it 28.
    expect(svg.match(/<rect /g)).toHaveLength(27);
  });

  it('(c) junction renders as an r=5 circle and its outgoing wire is walked via wires[0] (F6, e2#11)', () => {
    const svg = renderSvg(FIXTURE_JUNCTION, { tabId: 'tab1' });
    expect(svg).toContain(
      '<circle cx="200" cy="100" r="5" fill="#eeeeee" stroke="#999" stroke-width="1"/>',
    );
    // inject 'In' (w 100, center 100): output port (150, 100) → junction.
    expect(svg).toContain('<path d="M 150 100 C 175 100, 175 100, 200 100"');
    // junction → debug 'Sink' (w 100, center 300): input anchor (250, 100).
    expect(svg).toContain('<path d="M 200 100 C 225 100, 225 100, 250 100"');

    const j = entryById(renderGeometry(FIXTURE_JUNCTION, 'tab1'), 'jjjjjjjjjjjjjjjj');
    expect(j.kind).toBe('junction');
    expect([j.w, j.h]).toEqual([10, 10]);
    // Junction wires attach at the waypoint itself.
    expect(j.ports).toEqual([
      { kind: 'input', index: 0, x: 200, y: 100 },
      { kind: 'output', index: 0, x: 200, y: 100 },
    ]);
  });

  it('(d) e1 group containment: every member box lies inside its group bbox (F2)', () => {
    const entries = renderGeometry(e1, E1_TAB);
    const groups = e1.filter((n) => n.type === 'group') as Array<{
      id: string;
      name?: string;
      nodes: string[];
    }>;
    expect(groups).toHaveLength(6);
    let members = 0;
    for (const g of groups) {
      const gBox = entryById(entries, g.id);
      const gLeft = gBox.x - gBox.w / 2;
      const gTop = gBox.y - gBox.h / 2;
      for (const memberId of g.nodes) {
        const m = entries.find((e) => e.id === memberId);
        if (!m) continue; // non-rendered members would be a bug elsewhere
        members += 1;
        const label = `node ${memberId} in group ${g.name ?? g.id}`;
        expect(m.x - m.w / 2, `${label} left`).toBeGreaterThanOrEqual(gLeft);
        expect(m.y - m.h / 2, `${label} top`).toBeGreaterThanOrEqual(gTop);
        expect(m.x + m.w / 2, `${label} right`).toBeLessThanOrEqual(gLeft + gBox.w);
        expect(m.y + m.h / 2, `${label} bottom`).toBeLessThanOrEqual(gTop + gBox.h);
      }
    }
    expect(members).toBe(14);
  });

  it('(e) a node at (0,0) is fully visible: whole-body translate, no negative coordinates (F2)', () => {
    const flows: FlowsJson = [
      { id: 'tab1', type: 'tab', label: 'Origin' },
      { id: 'aaaaaaaaaaaaaaaa', type: 'debug', z: 'tab1', x: 0, y: 0, wires: [], name: 'D' },
    ];
    const svg = renderSvg(flows, { tabId: 'tab1' });
    // debug 'D': w 100, h 30, input-port overhang 5 → translate (+55, +15).
    expect(svg).toContain('<rect x="5" y="0" width="100" height="30"');
    expect(svg).toContain('<circle cx="5" cy="15"');
    expect(svg).not.toMatch(/[" ,=]-\d/); // no negative coordinate anywhere
    const entry = entryById(renderGeometry(flows, 'tab1'), 'aaaaaaaaaaaaaaaa');
    expect([entry.x, entry.y]).toEqual([55, 15]); // post-translate center
  });

  it('(f) every e1 wire starts at an output-port coordinate and ends at an input-port coordinate', () => {
    const entries = renderGeometry(e1, E1_TAB);
    const outputs = new Set<string>();
    const inputs = new Set<string>();
    for (const e of entries) {
      for (const p of e.ports) {
        (p.kind === 'output' ? outputs : inputs).add(`${p.x},${p.y}`);
      }
    }
    const svg = renderSvg(e1, { tabId: E1_TAB });
    const wires = parseWireEndpoints(svg);
    expect(wires).toHaveLength(12);
    for (const w of wires) {
      expect(outputs, `wire start ${w.from.join(',')}`).toContain(w.from.join(','));
      expect(inputs, `wire end ${w.to.join(',')}`).toContain(w.to.join(','));
    }
  });

  it('multi-output heights come from nodeDimensionsFor: 3-output function is 45px tall', () => {
    const entries = renderGeometry(FIXTURE_FUNCTION_THREE_OUTPUTS, 'tab1');
    const fan = entryById(entries, 'bbbbbbbbbbbbbbbb');
    expect(fan.h).toBe(45);
    const outs = fan.ports.filter((p) => p.kind === 'output');
    // 13px pitch symmetric about cy=100 (per-port-count fixture table).
    expect(outs.map((p) => p.y)).toEqual([87, 100, 113]);
    const svg = renderSvg(FIXTURE_FUNCTION_THREE_OUTPUTS, { tabId: 'tab1' });
    expect(svg).toContain('height="45"');
  });
});

describe('renderGeometry (frozen contract #1)', () => {
  const { flows: e1 } = loadE1();

  it('returns per-node {id, x, y, w, h, ports[]} for every canvas object on the tab', () => {
    const entries = renderGeometry(e1, E1_TAB);
    // 14 visual nodes + 6 groups + 6 comments; never the tab or the broker.
    expect(entries).toHaveLength(26);
    for (const e of entries) {
      expect(typeof e.id).toBe('string');
      expect(['node', 'junction', 'group', 'comment']).toContain(e.kind);
      for (const f of ['x', 'y', 'w', 'h'] as const) {
        expect(typeof e[f], `${e.id} ${f}`).toBe('number');
      }
      expect(Array.isArray(e.ports)).toBe(true);
    }
    expect(entries.filter((e) => e.kind === 'group')).toHaveLength(6);
    expect(entries.filter((e) => e.kind === 'comment')).toHaveLength(6);
    expect(entries.filter((e) => e.kind === 'node')).toHaveLength(14);
  });

  it('is center-convention and byte-consistent with the renderSvg output', () => {
    const entries = renderGeometry(e1, E1_TAB);
    const svg = renderSvg(e1, { tabId: E1_TAB });
    // e1 has no negative extents → translate is zero and geometry equals the
    // editor coordinates verbatim. Every node rect appears at center-w/2.
    for (const e of entries) {
      if (e.kind !== 'node') continue;
      expect(svg).toContain(
        `<rect x="${e.x - e.w / 2}" y="${e.y - e.h / 2}" width="${e.w}" height="${e.h}"`,
      );
    }
    const sw = entryById(entries, E1_SWITCH);
    expect([sw.x, sw.y]).toEqual([940, 260]); // flows.json x/y verbatim
  });

  it('subflow instances take port counts from the definition in/out arrays', () => {
    const flows: FlowsJson = [
      { id: 'tab1', type: 'tab', label: 'Subflow' },
      {
        id: 'sdsdsdsdsdsdsdsd',
        type: 'subflow',
        name: 'My Sub',
        in: [{ wires: [] }],
        out: [{ wires: [] }, { wires: [] }],
      },
      {
        id: 'sisisisisisisisi',
        type: 'subflow:sdsdsdsdsdsdsdsd',
        z: 'tab1',
        x: 300,
        y: 200,
        wires: [[], []],
        name: 'Sub I',
      },
    ];
    const inst = entryById(renderGeometry(flows, 'tab1'), 'sisisisisisisisi');
    expect(inst.ports.filter((p) => p.kind === 'input')).toHaveLength(1);
    expect(inst.ports.filter((p) => p.kind === 'output')).toHaveLength(2);
    expect(inst.h).toBe(nodeDimensionsFor('Sub I', { inputs: 1, outputs: 2 }).h);
  });

  it('defaults to the first tab and returns [] for an unknown tab id', () => {
    expect(renderGeometry(e1)).toEqual(renderGeometry(e1, E1_TAB));
    expect(renderGeometry(e1, 'nope')).toEqual([]);
  });

  it('is deterministic across runs', () => {
    expect(renderGeometry(e1, E1_TAB)).toEqual(renderGeometry(e1, E1_TAB));
  });
});
