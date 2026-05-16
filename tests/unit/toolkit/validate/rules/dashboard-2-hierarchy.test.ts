import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/dashboard-2-hierarchy.js';

describe('dashboard-2-hierarchy', () => {
  it('is a no-op when no Dashboard 2.0 nodes are present', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'd1', type: 'debug', z: 'tab1', x: 0, y: 0, wires: [] },
      ] as never),
    ).toEqual([]);
  });

  it('passes when the full chain resolves', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'base1', type: 'ui-base', name: 'Base', path: '/dashboard' },
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

  it('flags ui-page missing its ui reference', () => {
    const out = check([{ id: 'page1', type: 'ui-page', name: 'P', path: '/p' }] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['missing']).toBe('ui');
    expect(out[0]?.severity).toBe('error');
  });

  it('flags ui-page referencing missing ui-base', () => {
    const out = check([
      { id: 'page1', type: 'ui-page', name: 'P', path: '/p', ui: 'missing' },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['expected']).toBe('ui-base');
    expect(out[0]?.context?.['actual']).toBe('missing');
  });

  it('flags ui-group referencing missing ui-page', () => {
    const out = check([
      { id: 'base1', type: 'ui-base', name: 'B', path: '/d' },
      { id: 'group1', type: 'ui-group', name: 'G', page: 'missing' },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['expected']).toBe('ui-page');
  });

  it('flags ui-group missing its page field', () => {
    const out = check([{ id: 'group1', type: 'ui-group', name: 'G' }] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['missing']).toBe('page');
  });

  it('flags widget missing group field', () => {
    const out = check([
      { id: 'tab1', type: 'tab', label: 'T' },
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
      },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['missing']).toBe('group');
  });

  it('flags widget referencing missing ui-group', () => {
    const out = check([
      { id: 'tab1', type: 'tab', label: 'T' },
      {
        id: 'btn1',
        type: 'ui-button',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'Btn',
        group: 'missing',
      },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['expected']).toBe('ui-group');
  });

  it('passes ui-template with templateScope=widget:ui referencing a ui-base', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'base1', type: 'ui-base', name: 'B', path: '/d' },
        {
          id: 'tpl1',
          type: 'ui-template',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          name: 'T',
          templateScope: 'widget:ui',
          ui: 'base1',
          format: 'x',
        },
      ] as never),
    ).toEqual([]);
  });

  it('flags ui-template with templateScope=widget:ui missing ui field', () => {
    const out = check([
      { id: 'tab1', type: 'tab', label: 'T' },
      {
        id: 'tpl1',
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
    expect(out[0]?.context?.['missing']).toBe('ui');
    expect(out[0]?.context?.['templateScope']).toBe('widget:ui');
  });

  it('passes ui-template with templateScope=site:style referencing a ui-base', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'base1', type: 'ui-base', name: 'B', path: '/d' },
        {
          id: 'tpl1',
          type: 'ui-template',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          name: 'CSS',
          templateScope: 'site:style',
          ui: 'base1',
          format: '/* css */',
        },
      ] as never),
    ).toEqual([]);
  });

  it('passes ui-template with templateScope=widget:page referencing a ui-page', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'base1', type: 'ui-base', name: 'B', path: '/d' },
        { id: 'page1', type: 'ui-page', name: 'P', path: '/p', ui: 'base1' },
        {
          id: 'tpl1',
          type: 'ui-template',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          name: 'T',
          templateScope: 'widget:page',
          page: 'page1',
          format: 'x',
        },
      ] as never),
    ).toEqual([]);
  });

  it('does not require group on ui-control / ui-event', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        {
          id: 'ctl1',
          type: 'ui-control',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
        },
        {
          id: 'evt1',
          type: 'ui-event',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
        },
      ] as never),
    ).toEqual([]);
  });
});
