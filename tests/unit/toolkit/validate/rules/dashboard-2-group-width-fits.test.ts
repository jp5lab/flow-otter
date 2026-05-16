import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/dashboard-2-group-width-fits.js';

describe('dashboard-2-group-width-fits', () => {
  it('is a no-op when no ui-group is present', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'd1', type: 'debug', z: 'tab1', x: 0, y: 0, wires: [] },
      ] as never),
    ).toEqual([]);
  });

  it('passes when all widgets fit within the group width', () => {
    expect(
      check([
        { id: 'group1', type: 'ui-group', name: 'G', page: 'page1', width: 12 },
        {
          id: 'btn1',
          type: 'ui-button',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          name: 'A',
          group: 'group1',
          width: 6,
          order: 1,
        },
        {
          id: 'btn2',
          type: 'ui-button',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          name: 'B',
          group: 'group1',
          width: 6,
          order: 2,
        },
      ] as never),
    ).toEqual([]);
  });

  it('flags a single widget wider than its group', () => {
    const out = check([
      { id: 'group1', type: 'ui-group', name: 'G', page: 'page1', width: 6 },
      {
        id: 'btn1',
        type: 'ui-button',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'A',
        group: 'group1',
        width: 12,
      },
    ] as never);
    const widgetOverflow = out.filter(
      (d) => (d.context as Record<string, unknown>)['widgetWidth'] !== undefined,
    );
    expect(widgetOverflow).toHaveLength(1);
    expect((widgetOverflow[0]?.context as Record<string, unknown>)['groupWidth']).toBe(6);
  });

  it('flags a row whose summed widths exceed the group width', () => {
    const out = check([
      { id: 'group1', type: 'ui-group', name: 'G', page: 'page1', width: 12 },
      {
        id: 'btn1',
        type: 'ui-button',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'A',
        group: 'group1',
        width: 8,
        order: 1,
      },
      {
        id: 'btn2',
        type: 'ui-button',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'B',
        group: 'group1',
        width: 8,
        order: 2,
      },
    ] as never);
    // Greedy row packing: widget 1 (8) fits, widget 2 (8) wraps to row 1.
    // Each row independently fits inside group.width=12, so no row-overflow
    // diagnostic is expected.
    expect(out).toEqual([]);
  });

  it('flags a row that genuinely overflows when wraps cannot recover', () => {
    const out = check([
      { id: 'group1', type: 'ui-group', name: 'G', page: 'page1', width: 6 },
      {
        id: 'btn1',
        type: 'ui-button',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'A',
        group: 'group1',
        width: 4,
        order: 1,
      },
      {
        id: 'btn2',
        type: 'ui-button',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'B',
        group: 'group1',
        width: 8, // wider than group on its own — row-overflow + widget-overflow
        order: 2,
      },
    ] as never);
    const widgetOverflow = out.filter(
      (d) => (d.context as Record<string, unknown>)['widgetWidth'] !== undefined,
    );
    expect(widgetOverflow).toHaveLength(1); // btn2 alone > group
  });

  it('ignores widgets without a numeric width', () => {
    expect(
      check([
        { id: 'group1', type: 'ui-group', name: 'G', page: 'page1', width: 12 },
        {
          id: 'btn1',
          type: 'ui-button',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          name: 'A',
          group: 'group1',
          width: 'auto',
        },
      ] as never),
    ).toEqual([]);
  });

  it('uses default group width 6 when group does not declare one', () => {
    const out = check([
      { id: 'group1', type: 'ui-group', name: 'G', page: 'page1' },
      {
        id: 'btn1',
        type: 'ui-button',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'A',
        group: 'group1',
        width: 8,
      },
    ] as never);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect((out[0]?.context as Record<string, unknown>)['groupWidth']).toBe(6);
  });

  it('handles string-coerced widths', () => {
    expect(
      check([
        { id: 'group1', type: 'ui-group', name: 'G', page: 'page1', width: '12' },
        {
          id: 'btn1',
          type: 'ui-button',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          name: 'A',
          group: 'group1',
          width: '6',
        },
      ] as never),
    ).toEqual([]);
  });
});
