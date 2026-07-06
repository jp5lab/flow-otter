import { describe, expect, it } from 'vitest';

import {
  resolveCapabilities,
  type RuntimeCapabilities,
} from '../../../../../src/adapters/nodered/capabilities.js';
import { runValidators } from '../../../../../src/toolkit/validate/index.js';
import { check, KNOWN_ISSUES } from '../../../../../src/toolkit/validate/rules/known-issues.js';

function runtime(version: string): RuntimeCapabilities {
  return { version, capabilities: resolveCapabilities(version) };
}

const FLOW_WITH_GET_SETTING = [
  { id: 'tab1', type: 'tab', label: 'Main' },
  {
    id: 'fn1',
    type: 'function',
    z: 'tab1',
    x: 100,
    y: 100,
    wires: [[]],
    func: "const token = RED.util.getSetting('TOKEN'); msg.payload = token; return msg;",
  },
] as never;

describe('known-issues', () => {
  it('keeps the RED.util.getSetting issue on an exact affected-version list', () => {
    expect(KNOWN_ISSUES).toHaveLength(1);
    expect(KNOWN_ISSUES[0]).toMatchObject({
      id: 'node-red-function-red-util-getsetting-undefined',
      affectedVersions: ['5.0.0-beta.6', '5.0.0', '5.0.1'],
      fixedIn: null,
    });
  });

  it.each(['5.0.0-beta.6', '5.0.0', '5.0.1'])(
    'warns for RED.util.getSetting on Node-RED %s',
    (version) => {
      const out = check(FLOW_WITH_GET_SETTING, { runtime: runtime(version) });

      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        severity: 'warning',
        rule: 'known-issues',
        nodeId: 'fn1',
        tabId: 'tab1',
        context: {
          issue: 'node-red-function-red-util-getsetting-undefined',
          affected_versions: ['5.0.0-beta.6', '5.0.0', '5.0.1'],
          runtime_version: version,
          feature: 'function.RED.util.getSetting',
        },
      });
      expect(out[0]?.message).toContain('silently returns undefined');
      expect(out[0]?.message).toContain('env.get(...)');
    },
  );

  it.each(['4.1.11', '5.0.0-beta.5'])(
    'is silent for RED.util.getSetting outside affected runtime %s',
    (version) => {
      expect(check(FLOW_WITH_GET_SETTING, { runtime: runtime(version) })).toEqual([]);
    },
  );

  it('is silent when no runtime context is provided', () => {
    expect(check(FLOW_WITH_GET_SETTING)).toEqual([]);
  });

  it('ignores computed-member and non-call references', () => {
    const flows = [
      { id: 'tab1', type: 'tab', label: 'Main' },
      {
        id: 'fn1',
        type: 'function',
        z: 'tab1',
        x: 100,
        y: 100,
        wires: [[]],
        func: `
          RED.util['getSetting']('TOKEN');
          RED['util'].getSetting('TOKEN');
          const readSetting = RED.util.getSetting;
          return msg;
        `,
      },
    ] as never;

    expect(check(flows, { runtime: runtime('5.0.0') })).toEqual([]);
  });

  it('ignores unparseable function code', () => {
    const flows = [
      { id: 'tab1', type: 'tab', label: 'Main' },
      {
        id: 'fn1',
        type: 'function',
        z: 'tab1',
        x: 100,
        y: 100,
        wires: [[]],
        func: "if ( RED.util.getSetting('TOKEN');",
      },
    ] as never;

    expect(check(flows, { runtime: runtime('5.0.0') })).toEqual([]);
  });

  it('integrates through runValidators with runtime context', () => {
    expect(runValidators(FLOW_WITH_GET_SETTING).diagnostics).toEqual([]);
    expect(
      runValidators(FLOW_WITH_GET_SETTING, { runtime: runtime('5.0.1') }).diagnostics.some(
        (d) => d.rule === 'known-issues',
      ),
    ).toBe(true);
  });
});
