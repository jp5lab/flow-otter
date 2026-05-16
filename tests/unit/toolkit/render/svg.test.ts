import { describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../../../src/shared/flows-json.js';
import { renderSvg } from '../../../../src/toolkit/render/svg.js';

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
    ]) {
      expect(renderSvg(flows, { tabId: 'tab1' })).toBe(renderSvg(flows, { tabId: 'tab1' }));
    }
  });
});
