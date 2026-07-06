/**
 * REND-2 safety pin (test-first; written and verified green at HEAD BEFORE the
 * editor-true dimension model landed): the canonical e1 audit fixture is a
 * byte-identical decompile → compile fixed point.
 *
 * Why this pins the safety spine: REND-2 changes node dimensions consumed by
 * compile's group auto-fit. Auto-fit only fires for groups authored WITHOUT
 * explicit geometry; every group in e1 carries explicit x/y/w/h, and
 * decompile preserves explicit geometry verbatim (decompile.ts buildGroupSpec
 * position/size carry-through). So compile output for this fixture must be
 * byte-identical before AND after the dimension-model change — any drift here
 * means REND-2 leaked beyond the auto-fit path and broke the idempotent
 * compile / `_authoringKey` id-preservation invariants.
 *
 * Fixture: tests/fixtures/audit-2026-06-10/e1-flows.json — verbatim copy of
 * eval-results/2026-06-10-layout-audit/e1-flows.json (sterile-stack capture;
 * charter member of the canonical audit fixture dir, see fix-plan EVAL-3).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../../../src/shared/canonical-json.js';
import type { FlowsJson } from '../../../../src/shared/flows-json.js';
import { compile } from '../../../../src/toolkit/authoring/compile.js';
import { decompile } from '../../../../src/toolkit/authoring/decompile.js';

interface E1Fixture {
  flows: FlowsJson;
  rev: string;
}

function loadE1(): E1Fixture {
  const path = fileURLToPath(
    new URL('../../../fixtures/audit-2026-06-10/e1-flows.json', import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as E1Fixture;
}

const AUTHORING_KEY = '_authoringKey';

describe('canonical e1 fixture: decompile → compile byte identity (REND-2 safety pin)', () => {
  const { flows } = loadE1();

  it('sanity: the fixture is the audit flow (6 groups, all with explicit geometry)', () => {
    const groups = flows.filter((n) => n.type === 'group');
    expect(groups).toHaveLength(6);
    for (const g of groups) {
      const geo = g as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
      for (const f of ['x', 'y', 'w', 'h'] as const) {
        expect(typeof geo[f], `group ${g.id} explicit ${f}`).toBe('number');
      }
    }
    const names = flows.map((n) => (n as { name?: string }).name);
    // The audit's named F11 width cases live in this fixture.
    expect(names).toContain('Parse reading');
    expect(names).toContain('Debounce repeat alarms');
  });

  it('round-trips byte-identically (canonical JSON of the full flows array)', () => {
    const spec = decompile(flows);
    const out = compile(spec, { prior: flows });
    expect(canonicalJson(out.flows)).toBe(canonicalJson(flows));
  });

  it('preserves the historical stamped mqtt-broker canvas fields byte-identically', () => {
    const brokerBefore = flows.find((n) => n.type === 'mqtt-broker') as
      | Record<string, unknown>
      | undefined;
    expect(brokerBefore).toBeDefined();
    expect(brokerBefore?.['x']).toBe(540);
    expect(brokerBefore?.['y']).toBe(660);
    expect(brokerBefore?.['z']).toBe('f6f2187d.f17ca8');
    expect(brokerBefore?.['wires']).toEqual([[]]);

    const spec = decompile(flows);
    const brokerSpec = spec.configNodes?.find((n) => n.key === 'broker_main');
    expect(brokerSpec?.type).toBe('mqtt-broker');
    expect(spec.tabs.flatMap((t) => t.nodes).some((n) => n.key === 'broker_main')).toBe(false);

    const out = compile(spec, { prior: flows });
    const brokerAfter = out.flows.find((n) => n.id === brokerBefore?.['id']) as
      | Record<string, unknown>
      | undefined;
    expect(brokerAfter).toBeDefined();
    expect(brokerAfter?.['type']).toBe('mqtt-broker');
    expect(brokerAfter?.['x']).toBe(brokerBefore?.['x']);
    expect(brokerAfter?.['y']).toBe(brokerBefore?.['y']);
    expect(brokerAfter?.['z']).toBe(brokerBefore?.['z']);
    expect(brokerAfter?.['wires']).toEqual(brokerBefore?.['wires']);
    expect(canonicalJson(out.flows)).toBe(canonicalJson(flows));
  });

  it('preserves every node id and _authoringKey exactly', () => {
    const out = compile(decompile(flows), { prior: flows });
    const priorById = new Map(flows.map((n) => [n.id, n]));
    expect(out.flows.map((n) => n.id).sort()).toEqual(flows.map((n) => n.id).sort());
    for (const n of out.flows) {
      const prior = priorById.get(n.id);
      expect(prior, `node ${n.id} existed before`).toBeDefined();
      const keyNow = (n as Record<string, unknown>)[AUTHORING_KEY];
      const keyWas = (prior as Record<string, unknown>)[AUTHORING_KEY];
      expect(keyNow, `node ${n.id} ${AUTHORING_KEY}`).toEqual(keyWas);
    }
  });

  it('is a stable fixed point (second compile pass changes nothing, same hash)', () => {
    const first = compile(decompile(flows), { prior: flows });
    const second = compile(decompile(first.flows), { prior: first.flows });
    expect(canonicalJson(second.flows)).toBe(canonicalJson(first.flows));
    expect(second.hash).toBe(first.hash);
  });
});
