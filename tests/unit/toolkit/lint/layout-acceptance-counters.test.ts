import { describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../../../src/shared/flows-json.js';
import {
  commentPileOffenders,
  offCanvasGroupOffenders,
} from '../../../../src/toolkit/lint/layout-acceptance.js';

const TAB = { id: 'tab1', type: 'tab', label: 'Main' } as const;

describe('layout acceptance counters', () => {
  it('counts each comment in a same-center pile as one offender', () => {
    const flows = [
      TAB,
      { id: 'c1', type: 'comment', z: TAB.id, x: 0, y: 0, name: 'first' },
      { id: 'c2', type: 'comment', z: TAB.id, x: 0, y: 0, name: 'second' },
      { id: 'c3', type: 'comment', z: TAB.id, x: 200, y: 0, name: 'third' },
    ] as FlowsJson;

    expect(commentPileOffenders(flows)).toEqual([
      expect.objectContaining({ id: 'c1', tabId: TAB.id, pileSize: 2 }),
      expect.objectContaining({ id: 'c2', tabId: TAB.id, pileSize: 2 }),
    ]);
  });

  it('counts group boxes outside the Node-RED canvas bounds', () => {
    const flows = [
      TAB,
      {
        id: 'inside',
        type: 'group',
        z: TAB.id,
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        name: 'Inside',
        nodes: [],
      },
      {
        id: 'left',
        type: 'group',
        z: TAB.id,
        x: -20,
        y: 20,
        w: 100,
        h: 100,
        name: 'Left',
        nodes: [],
      },
      {
        id: 'right',
        type: 'group',
        z: TAB.id,
        x: 2360,
        y: 20,
        w: 80,
        h: 100,
        name: 'Right',
        nodes: [],
      },
    ] as FlowsJson;

    expect(offCanvasGroupOffenders(flows).map((offender) => offender.id)).toEqual([
      'left',
      'right',
    ]);
  });
});
