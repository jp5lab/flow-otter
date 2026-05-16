import { describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../../../../src/shared/flows-json.js';
import {
  check,
  RULE,
} from '../../../../../src/toolkit/validate/rules/dashboard-2-destructive-needs-confirm.js';

function makeFlows(nodes: Array<Record<string, unknown>>): FlowsJson {
  return nodes as unknown as FlowsJson;
}

describe('dashboard-2-destructive-needs-confirm', () => {
  it('warns on ui-button-group with abort payload and no confirmation in group', () => {
    const flows = makeFlows([
      {
        id: 'btn1',
        type: 'ui-button-group',
        z: 't1',
        group: 'g1',
        name: 'Cmds',
        options: [
          { label: 'Start', value: 'start' },
          { label: 'Stop', value: 'stop' },
          { label: 'Abort', value: 'abort' },
        ],
      },
    ]);
    const diags = check(flows);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.rule).toBe(RULE);
    expect(diags[0]?.severity).toBe('warning');
    expect(diags[0]?.message).toMatch(/destructive payload/);
    expect(diags[0]?.context).toMatchObject({
      destructive_payloads: expect.arrayContaining(['stop', 'abort']) as readonly string[],
    });
  });

  it('does NOT warn when a ui-template confirm widget shares the group', () => {
    const flows = makeFlows([
      {
        id: 'btn1',
        type: 'ui-button-group',
        z: 't1',
        group: 'g1',
        name: 'Cmds',
        options: [{ label: 'Abort', value: 'abort' }],
      },
      { id: 'tpl1', type: 'ui-template', z: 't1', group: 'g1', name: 'Confirm' },
    ]);
    expect(check(flows)).toEqual([]);
  });

  it('does NOT warn when an authoring-key contains "confirm" in the same group', () => {
    const flows = makeFlows([
      {
        id: 'btn1',
        type: 'ui-button-group',
        z: 't1',
        group: 'g1',
        options: [{ value: 'shutdown' }],
      },
      {
        id: 'btn2',
        type: 'ui-button',
        z: 't1',
        group: 'g1',
        _authoringKey: 'abort-confirm',
        payload: '',
      },
    ]);
    expect(check(flows)).toEqual([]);
  });

  it('warns on ui-button with payload=stop', () => {
    const flows = makeFlows([
      {
        id: 'btn',
        type: 'ui-button',
        z: 't1',
        group: 'g1',
        name: 'Stop',
        payload: 'stop',
        payloadType: 'str',
      },
    ]);
    const diags = check(flows);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.context).toMatchObject({ destructive_payloads: ['stop'] });
  });

  it('warns on label "Abort" even with non-matching payload word', () => {
    const flows = makeFlows([
      {
        id: 'btn',
        type: 'ui-button',
        z: 't1',
        group: 'g1',
        label: 'Abort Now',
        payload: 'fire',
        payloadType: 'str',
      },
    ]);
    const diags = check(flows);
    expect(diags.length).toBeGreaterThan(0);
  });

  it('ignores non-destructive buttons', () => {
    const flows = makeFlows([
      {
        id: 'btn',
        type: 'ui-button',
        z: 't1',
        group: 'g1',
        name: 'Start',
        payload: 'start',
        payloadType: 'str',
      },
    ]);
    expect(check(flows)).toEqual([]);
  });

  it('ignores ui-text / ui-chart / non-button widgets entirely', () => {
    const flows = makeFlows([
      {
        id: 't1',
        type: 'ui-text',
        z: 't1',
        group: 'g1',
        label: 'Abort status',
        format: '{{msg.payload}}',
      },
    ]);
    expect(check(flows)).toEqual([]);
  });
});
