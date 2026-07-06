import { describe, expect, it } from 'vitest';

import type { FlowsJson, FlowsJsonNode } from '../../../src/shared/flows-json.js';
import {
  LANE_GAP,
  LANE_NAMES,
  LANE_ORDER,
  deriveFlowsJsonLanes,
  deriveTabSpecLanes,
} from '../../../src/toolkit/lanes.js';
import type { TabSpec } from '../../../src/toolkit/authoring/types.js';

const TAB = { id: 'tab1', type: 'tab', label: 'Main' } as const;

function flow(...nodes: FlowsJsonNode[]): FlowsJson {
  return [TAB, ...nodes] as FlowsJson;
}

function regular(
  id: string,
  type: string,
  wires: readonly (readonly string[])[] = [],
  extra: Record<string, unknown> = {},
): FlowsJsonNode {
  return { id, type, z: TAB.id, x: 100, y: 100, wires: wires.map((row) => [...row]), ...extra };
}

describe('shared lane constants', () => {
  it('exports the ratified lane vocabulary and gap', () => {
    expect(LANE_NAMES).toEqual(['main', 'indicate', 'error']);
    expect(LANE_ORDER).toEqual(['main', 'indicate', 'error']);
    expect(LANE_GAP).toBe(120);
  });
});

describe('deriveFlowsJsonLanes', () => {
  it('marks catch closure catch -> fn -> debug as error lane', () => {
    const lanes = deriveFlowsJsonLanes(
      flow(
        regular('catch1', 'catch', [['fn1']]),
        regular('fn1', 'function', [['debug1']]),
        regular('debug1', 'debug'),
      ),
    );

    expect(lanes.get(TAB.id)?.lanesById).toEqual(
      new Map([
        ['catch1', 'error'],
        ['fn1', 'error'],
        ['debug1', 'error'],
      ]),
    );
  });

  it('keeps a dual-fed error descendant in the main lane', () => {
    const lanes = deriveFlowsJsonLanes(
      flow(
        regular('inject1', 'inject', [['fn1']]),
        regular('catch1', 'catch', [['fn1']]),
        regular('fn1', 'function', [['debug1']]),
        regular('debug1', 'debug'),
      ),
    );

    expect(lanes.get(TAB.id)?.lanesById.get('catch1')).toBe('error');
    expect(lanes.get(TAB.id)?.lanesById.get('fn1')).toBe('main');
    expect(lanes.get(TAB.id)?.lanesById.get('debug1')).toBe('main');
  });

  it('traverses junctions when deriving error closure', () => {
    const lanes = deriveFlowsJsonLanes(
      flow(
        regular('catch1', 'catch', [['j1']]),
        { id: 'j1', type: 'junction', z: TAB.id, x: 200, y: 100, wires: [['fn1']] },
        regular('fn1', 'function', [['debug1']]),
        regular('debug1', 'debug'),
      ),
    );

    expect(lanes.get(TAB.id)?.lanesById.get('j1')).toBe('error');
    expect(lanes.get(TAB.id)?.lanesById.get('fn1')).toBe('error');
  });

  it('uses status nodes as indicate-lane seeds', () => {
    const lanes = deriveFlowsJsonLanes(
      flow(
        regular('status1', 'status', [['fn1']]),
        regular('fn1', 'function', [['debug1']]),
        regular('debug1', 'debug'),
      ),
    );

    expect(lanes.get(TAB.id)?.lanesById).toEqual(
      new Map([
        ['status1', 'indicate'],
        ['fn1', 'indicate'],
        ['debug1', 'indicate'],
      ]),
    );
  });

  it('reads explicit _authoringLane annotations before topology inference', () => {
    const lanes = deriveFlowsJsonLanes(
      flow(
        regular('inject1', 'inject', [['fn1']], { _authoringLane: 'error' }),
        regular('fn1', 'function', [['debug1']]),
        regular('debug1', 'debug'),
      ),
    );

    expect(lanes.get(TAB.id)?.lanesById.get('inject1')).toBe('error');
    expect(lanes.get(TAB.id)?.lanesById.get('fn1')).toBe('error');
  });

  it('inherits explicit group lanes through group.nodes membership', () => {
    const lanes = deriveFlowsJsonLanes(
      flow(
        {
          id: 'g1',
          type: 'group',
          z: TAB.id,
          x: 80,
          y: 80,
          w: 320,
          h: 120,
          name: '',
          nodes: ['fn1'],
          _authoringLane: 'error',
        },
        regular('fn1', 'function', [['debug1']]),
        regular('debug1', 'debug'),
      ),
    );

    expect(lanes.get(TAB.id)?.lanesById.get('fn1')).toBe('error');
    expect(lanes.get(TAB.id)?.lanesById.get('debug1')).toBe('error');
  });
});

describe('deriveTabSpecLanes', () => {
  it('adapts TabSpec topology through the same closure algorithm', () => {
    const tab: TabSpec = {
      id: 'tab1',
      label: 'Main',
      nodes: [
        { key: 'catch1', type: 'catch', position: { x: 100, y: 100 } },
        { key: 'fn1', type: 'function', position: { x: 300, y: 100 } },
        { key: 'debug1', type: 'debug', position: { x: 500, y: 100 } },
      ],
      connections: [
        { fromKey: 'catch1', outputPort: 0, toKey: 'fn1' },
        { fromKey: 'fn1', outputPort: 0, toKey: 'debug1' },
      ],
      groups: [],
      comments: [],
    };

    expect(deriveTabSpecLanes(tab).lanesById).toEqual(
      new Map([
        ['catch1', 'error'],
        ['fn1', 'error'],
        ['debug1', 'error'],
      ]),
    );
  });
});
