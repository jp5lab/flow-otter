import { describe, expect, it } from 'vitest';

import {
  findLinkCallTargets,
  hasRedUtilGetSettingCall,
} from '../../../../../src/toolkit/validate/rules/_function-ast.js';

describe('findLinkCallTargets', () => {
  it('finds literal node.linkcall targets', () => {
    expect(findLinkCallTargets("node.linkcall('Pump A', msg);")).toEqual(['Pump A']);
  });

  it('dedupes multiple literal targets while preserving first-seen order', () => {
    expect(
      findLinkCallTargets(`
        node.linkcall('alpha', msg);
        if (msg.ok) node.linkcall("beta", msg);
        node.linkcall('alpha', msg);
      `),
    ).toEqual(['alpha', 'beta']);
  });

  it('finds nested node.linkcall calls', () => {
    expect(
      findLinkCallTargets(`
        function route() {
          return node.linkcall('nested', msg);
        }
      `),
    ).toEqual(['nested']);
  });

  it('skips non-literal first arguments', () => {
    expect(
      findLinkCallTargets(`
        const target = 'alpha';
        node.linkcall(target, msg);
        node.linkcall(\`beta-\${msg.topic}\`, msg);
      `),
    ).toEqual([]);
  });

  it('skips linkcall calls on other receivers', () => {
    expect(
      findLinkCallTargets(`
        other.linkcall('wrong', msg);
        node['linkcall']('computed', msg);
      `),
    ).toEqual([]);
  });

  it('returns empty results on parse failure', () => {
    expect(findLinkCallTargets('if (')).toEqual([]);
  });
});

describe('hasRedUtilGetSettingCall', () => {
  it('detects RED.util.getSetting calls', () => {
    expect(hasRedUtilGetSettingCall("const value = RED.util.getSetting('API_KEY');")).toBe(true);
  });

  it('detects nested RED.util.getSetting calls', () => {
    expect(
      hasRedUtilGetSettingCall(`
        function resolveName() {
          return RED.util.getSetting('DISPLAY_NAME');
        }
      `),
    ).toBe(true);
  });

  it('ignores computed members', () => {
    expect(
      hasRedUtilGetSettingCall(`
        RED.util['getSetting']('A');
        RED['util'].getSetting('B');
      `),
    ).toBe(false);
  });

  it('ignores non-call references and other member paths', () => {
    expect(
      hasRedUtilGetSettingCall(`
        const f = RED.util.getSetting;
        RED.settings.getSetting('A');
        red.util.getSetting('B');
      `),
    ).toBe(false);
  });

  it('returns false on parse failure', () => {
    expect(hasRedUtilGetSettingCall('if (')).toBe(false);
  });
});
