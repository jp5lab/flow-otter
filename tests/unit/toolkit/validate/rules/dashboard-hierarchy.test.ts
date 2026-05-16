import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/dashboard-hierarchy.js';

const WIDGET_NO_GROUP_FIXTURE = path.join(
  __dirname,
  '../../../../fixtures/broken/dashboard-hierarchy-widget-no-group.flows.json',
);
const GROUP_NO_PAGE_FIXTURE = path.join(
  __dirname,
  '../../../../fixtures/broken/dashboard-hierarchy-group-no-page.flows.json',
);
const PAGE_NO_BASE_FIXTURE = path.join(
  __dirname,
  '../../../../fixtures/broken/dashboard-hierarchy-page-no-base.flows.json',
);

describe('dashboard-hierarchy', () => {
  it('is a no-op when no ui_* nodes are present', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'd1', type: 'debug', z: 'tab1', x: 0, y: 0, wires: [] },
      ] as never),
    ).toEqual([]);
  });

  it('passes when full hierarchy chain resolves', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'base1', type: 'ui_base', name: 'Base' },
        { id: 'page1', type: 'ui_page', name: 'Page', ui: 'base1' },
        { id: 'group1', type: 'ui_group', name: 'Group', page: 'page1' },
        {
          id: 'btn1',
          type: 'ui_button',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          group: 'group1',
        },
      ] as never),
    ).toEqual([]);
  });

  it('passes when FlowFuse Dashboard 2 hierarchy chain resolves', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'base1', type: 'ui-base', name: 'Base' },
        { id: 'page1', type: 'ui-page', name: 'Page', ui: 'base1' },
        { id: 'group1', type: 'ui-group', name: 'Group', page: 'page1' },
        {
          id: 'btn1',
          type: 'ui-button',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          group: 'group1',
        },
      ] as never),
    ).toEqual([]);
  });

  it('flags widget that references missing ui_group', async () => {
    const flows = JSON.parse(await readFile(WIDGET_NO_GROUP_FIXTURE, 'utf8')) as never;
    const out = check(flows);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.context?.expected).toBe('ui_group');
    expect(out[0]?.context?.parent).toBe('ui_widget');
  });

  it('flags FlowFuse Dashboard 2 widget that references missing ui-group', () => {
    const out = check([
      { id: 'tab1', type: 'tab', label: 'T' },
      { id: 'base1', type: 'ui-base', name: 'Base' },
      { id: 'page1', type: 'ui-page', name: 'Page', ui: 'base1' },
      {
        id: 'btn1',
        type: 'ui-button',
        z: 'tab1',
        x: 0,
        y: 0,
        wires: [[]],
        group: 'missing',
      },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.context?.expected).toBe('ui-group');
    expect(out[0]?.context?.parent).toBe('ui_widget');
  });

  it('flags ui_group that references missing ui_page', async () => {
    const flows = JSON.parse(await readFile(GROUP_NO_PAGE_FIXTURE, 'utf8')) as never;
    const out = check(flows);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.context?.expected).toBe('ui_page');
    expect(out[0]?.context?.parent).toBe('ui_group');
  });

  it('flags ui_page that references missing ui_base', async () => {
    const flows = JSON.parse(await readFile(PAGE_NO_BASE_FIXTURE, 'utf8')) as never;
    const out = check(flows);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.context?.expected).toBe('ui_base');
    expect(out[0]?.context?.parent).toBe('ui_page');
  });

  it('skips widget with no group field', () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'T' },
        { id: 'group1', type: 'ui_group', name: 'Group' },
        {
          id: 'btn1',
          type: 'ui_button',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
        },
      ] as never),
    ).toEqual([]);
  });
});
