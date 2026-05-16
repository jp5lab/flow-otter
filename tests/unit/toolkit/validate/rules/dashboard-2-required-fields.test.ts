import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/dashboard-2-required-fields.js';

describe('dashboard-2-required-fields', () => {
  it('is a no-op when no Dashboard 2.0 nodes are present', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'd1', type: 'debug', z: 'tab1', x: 0, y: 0, wires: [] },
      ] as never),
    ).toEqual([]);
  });

  it('passes a fully populated ui-base / ui-page / ui-group / widget set', () => {
    expect(
      check([
        { id: 'base1', type: 'ui-base', name: 'B', path: '/d' },
        { id: 'page1', type: 'ui-page', name: 'P', path: '/p', ui: 'base1' },
        { id: 'group1', type: 'ui-group', name: 'G', page: 'page1' },
        {
          id: 'btn1',
          type: 'ui-button',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          name: 'Btn',
          group: 'group1',
        },
      ] as never),
    ).toEqual([]);
  });

  it('flags ui-base missing path', () => {
    const out = check([{ id: 'b1', type: 'ui-base', name: 'B' }] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['field']).toBe('path');
  });

  it('flags ui-page missing path and ui', () => {
    const out = check([{ id: 'p1', type: 'ui-page', name: 'P' }] as never);
    expect(out).toHaveLength(2);
    const fields = out.map((d) => d.context?.['field']).sort();
    expect(fields).toEqual(['path', 'ui']);
  });

  it('flags ui-form missing options', () => {
    const out = check([
      {
        id: 'f1',
        type: 'ui-form',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'Form',
        group: 'group1',
      },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['field']).toBe('options');
  });

  it('flags ui-chart missing chartType and xAxisType', () => {
    const out = check([
      {
        id: 'c1',
        type: 'ui-chart',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'Chart',
        group: 'group1',
      },
    ] as never);
    const fields = out.map((d) => d.context?.['field']).sort();
    expect(fields).toEqual(['chartType', 'xAxisType']);
  });

  it('flags ui-template missing format', () => {
    const out = check([
      {
        id: 't1',
        type: 'ui-template',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'T',
        group: 'group1',
      },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['field']).toBe('format');
  });

  it('flags ui-template with templateScope=widget:ui missing the ui anchor', () => {
    const out = check([
      {
        id: 't1',
        type: 'ui-template',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'T',
        templateScope: 'widget:ui',
        format: 'x',
      },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['field']).toBe('ui');
  });

  it('flags every type missing name', () => {
    const out = check([
      { id: 'b1', type: 'ui-base', path: '/d' },
      { id: 'p1', type: 'ui-page', path: '/p', ui: 'b1' },
      { id: 'g1', type: 'ui-group', page: 'p1' },
    ] as never);
    const nameMissing = out.filter((d) => d.context?.['field'] === 'name');
    expect(nameMissing).toHaveLength(3);
  });

  it('emits one diagnostic per missing field', () => {
    const out = check([{ id: 'p1', type: 'ui-page' }] as never);
    expect(out).toHaveLength(3); // name + path + ui
  });
});
