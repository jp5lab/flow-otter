import { describe, expect, it } from 'vitest';

import { findLinkCallTargets } from '../../../../../src/toolkit/validate/rules/_function-ast.js';

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
