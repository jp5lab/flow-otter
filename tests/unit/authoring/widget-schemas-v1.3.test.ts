import { describe, expect, it } from 'vitest';

import {
  getWidgetAnchorRequirement,
  getWidgetSchema,
  knownWidgetTypes,
} from '../../../src/toolkit/authoring/widget-schemas.js';

/**
 * Coverage for the 10 widget schemas added in v1.3.0 / Item 9 of
 * the v1.3.0 plan (docs/DESIGN.md). Each schema is permissive (`.passthrough`) — these
 * tests verify the named fields validate, plus the anchor requirement is
 * registered so add_dashboard_widget can place each widget correctly.
 */

const NEW_WIDGETS = [
  'ui-button',
  'ui-button-group',
  'ui-text',
  'ui-notification',
  'ui-template',
  'ui-form',
  'ui-table',
  'ui-chart',
  'ui-gauge',
  'ui-control',
] as const;

describe('v1.3.0 widget schemas', () => {
  it.each(NEW_WIDGETS)('schema for %s is registered', (name) => {
    expect(getWidgetSchema(name)).toBeDefined();
  });

  it.each(NEW_WIDGETS)('anchor requirement for %s is registered', (name) => {
    expect(getWidgetAnchorRequirement(name)).toBeDefined();
  });

  it('all 10 widgets appear in knownWidgetTypes', () => {
    const known = new Set(knownWidgetTypes());
    for (const w of NEW_WIDGETS) expect(known.has(w)).toBe(true);
  });

  it('ui-button accepts minimal config + ISA-101 confirm fields', () => {
    const s = getWidgetSchema('ui-button')!;
    expect(s.safeParse({ label: 'Stop', payload: 'stop' }).success).toBe(true);
    expect(
      s.safeParse({ label: 'Abort', payload: 'abort', confirm: true, confirmMessage: 'Really?' })
        .success,
    ).toBe(true);
  });

  it('ui-button-group accepts options array', () => {
    const s = getWidgetSchema('ui-button-group')!;
    const result = s.safeParse({
      label: 'Mode',
      options: [
        { label: 'Run', value: 'run' },
        { label: 'Stop', value: 'stop', color: '#d44' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('ui-chart requires chartType', () => {
    const s = getWidgetSchema('ui-chart')!;
    expect(s.safeParse({ chartType: 'line' }).success).toBe(true);
    // chartType is required — empty object should fail
    expect(s.safeParse({}).success).toBe(false);
  });

  it('ui-chart accepts xAxisLimit (Item 11 unbounded-chart-append validator hook)', () => {
    const s = getWidgetSchema('ui-chart')!;
    const r = s.safeParse({ chartType: 'line', xAxisLimit: 500, action: 'append' });
    expect(r.success).toBe(true);
  });

  it('ui-gauge requires style', () => {
    const s = getWidgetSchema('ui-gauge')!;
    expect(s.safeParse({ style: 'needle', min: 0, max: 100 }).success).toBe(true);
    expect(s.safeParse({ min: 0, max: 100 }).success).toBe(false);
  });

  it('ui-table requires maxrows', () => {
    const s = getWidgetSchema('ui-table')!;
    expect(s.safeParse({ maxrows: 100 }).success).toBe(true);
    expect(s.safeParse({}).success).toBe(false);
  });

  it('ui-form accepts options array of field definitions', () => {
    const s = getWidgetSchema('ui-form')!;
    const r = s.safeParse({
      label: 'Login',
      options: [
        { label: 'User', key: 'user', type: 'text', required: true },
        { label: 'Pass', key: 'pass', type: 'password' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('ui-notification accepts position enum', () => {
    const s = getWidgetSchema('ui-notification')!;
    const r = s.safeParse({ position: 'top right', displayTime: 5, allowDismiss: true });
    expect(r.success).toBe(true);
  });

  it('ui-template accepts code + scope', () => {
    const s = getWidgetSchema('ui-template')!;
    const r = s.safeParse({
      name: 'Custom Widget',
      code: '<v-card><v-icon>mdi-alert</v-icon></v-card>',
      scope: 'local',
    });
    expect(r.success).toBe(true);
  });

  it('ui-control accepts events array', () => {
    const s = getWidgetSchema('ui-control')!;
    const r = s.safeParse({
      events: [{ type: 'navigate', target: '/dashboard' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('catalog gap closure', () => {
  it('catalog reflects v1.3.0 widgets as supported', async () => {
    const { buildCatalog } = await import('../../../src/toolkit/catalog/index.js');
    const cat = buildCatalog('1.3.0-test');
    const missing = cat.dashboard_widgets.filter((w) => w.flow_otter_status === 'missing');
    expect(
      missing.length,
      `Widgets still marked missing: ${missing.map((w) => w.widget).join(', ')}`,
    ).toBe(0);
  });
});
