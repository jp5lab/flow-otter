import { describe, expect, it } from 'vitest';

import type { FlowsJson, FlowsJsonNode } from '../../../../src/shared/flows-json.js';
import { lintFlows } from '../../../../src/toolkit/lint/flows-lint.js';

const TAB = { id: 'tab1', type: 'tab', label: 'Main' } as const;

function regular(
  id: string,
  type: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
): FlowsJsonNode {
  return { id, type, z: TAB.id, x, y, wires: [], ...extra };
}

function backwardWireFixture(count: number): FlowsJson {
  const targets = Array.from({ length: count }, (_, i) => `dst${i}`);
  return [
    TAB,
    regular('src', 'inject', 500, 200, { wires: targets.map((id) => [id]) }),
    ...targets.map((id, i) => regular(id, 'debug', 100, 40 + i * 40)),
  ] as FlowsJson;
}

describe('lintFlows layout report', () => {
  it('adds capped layout scores only when requested', () => {
    const flows = backwardWireFixture(12);

    expect(lintFlows(flows)).not.toHaveProperty('layout');

    const report = lintFlows(flows, { layout: true });
    const backward = report.layout?.rules.find((r) => r.rule === 'layout-backward-wires');

    expect(report.layout?.overall).toBeLessThan(1);
    expect(backward).toMatchObject({
      rule: 'layout-backward-wires',
      offender_count: 12,
    });
    expect(backward?.offenders).toHaveLength(10);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', rule: 'layout-backward-wires' }),
    );
  });
});
