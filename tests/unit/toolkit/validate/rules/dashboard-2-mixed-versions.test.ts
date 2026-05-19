import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/dashboard-2-mixed-versions.js';

describe('dashboard-2-mixed-versions', () => {
  it('is a no-op when only Dashboard 2.0 nodes are present', () => {
    expect(
      check([
        { id: 'b1', type: 'ui-base', name: 'B', path: '/d' },
        { id: 'p1', type: 'ui-page', name: 'P', path: '/p', ui: 'b1' },
        { id: 'g1', type: 'ui-group', name: 'G', page: 'p1' },
      ] as never),
    ).toEqual([]);
  });

  it('is a no-op when only Dashboard 1.0 nodes are present', () => {
    expect(
      check([
        { id: 'b1', type: 'ui_base', name: 'B' },
        { id: 't1', type: 'ui_tab', name: 'T' },
        { id: 'g1', type: 'ui_group', name: 'G' },
      ] as never),
    ).toEqual([]);
  });

  it('is a no-op when no UI nodes at all are present', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'd1', type: 'debug', z: 'tab1', x: 0, y: 0, wires: [] },
      ] as never),
    ).toEqual([]);
  });

  it('warns once per Dashboard 1.0 node when both versions coexist', () => {
    const out = check([
      { id: 'b1', type: 'ui-base', name: 'B', path: '/d' },
      { id: 'p1', type: 'ui-page', name: 'P', path: '/p', ui: 'b1' },
      { id: 'old1', type: 'ui_button', z: 'tab1', x: 0, y: 0, wires: [[]], name: 'Old' },
      { id: 'old2', type: 'ui_text', z: 'tab1', x: 0, y: 0, wires: [[]], name: 'Old2' },
    ] as never);
    expect(out).toHaveLength(2);
    for (const d of out) {
      expect(d.severity).toBe('warning');
      expect(d.context?.['version']).toBe('v1');
    }
  });

  it('emits a warning, never an error', () => {
    const out = check([
      { id: 'b1', type: 'ui-base', name: 'B', path: '/d' },
      { id: 'old1', type: 'ui_button', z: 'tab1', x: 0, y: 0, wires: [[]], name: 'Old' },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.message).toMatch(/migrat(e|ing|ion)/);
  });

  it('records the v1 and v2 type sets in context', () => {
    const out = check([
      { id: 'b1', type: 'ui-base', name: 'B', path: '/d' },
      {
        id: 'btn-new',
        type: 'ui-button',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        name: 'New',
        group: 'g1',
      },
      { id: 'btn-old', type: 'ui_button', z: 'tab1', x: 0, y: 0, wires: [[]], name: 'Old' },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.context?.['v1Types']).toEqual(['ui_button']);
    expect((out[0]?.context?.['v2Types'] as string[]).sort()).toEqual(['ui-base', 'ui-button']);
  });
});
