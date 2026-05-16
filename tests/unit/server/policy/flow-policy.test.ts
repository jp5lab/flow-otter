import { describe, expect, it } from 'vitest';

import {
  enforceMaxFlowSize,
  enforceNodeTypePolicy,
} from '../../../../src/server/policy/flow-policy.js';
import type { FlowsJson } from '../../../../src/shared/flows-json.js';

const FLOWS_FIXTURE: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'Main' },
  { id: 'n1', type: 'inject', z: 'tab1', x: 100, y: 100, wires: [[]] },
  { id: 'n2', type: 'http request', z: 'tab1', x: 200, y: 100, wires: [[]] },
  { id: 'n3', type: 'debug', z: 'tab1', x: 300, y: 100, wires: [] },
];

describe('enforceMaxFlowSize', () => {
  it('passes when under limit', () => {
    expect(() => enforceMaxFlowSize(FLOWS_FIXTURE, 10_000)).not.toThrow();
  });

  it('throws when over limit', () => {
    expect(() => enforceMaxFlowSize(FLOWS_FIXTURE, 50)).toThrow(/exceeds MAX_FLOW_SIZE_BYTES/);
  });
});

describe('enforceNodeTypePolicy', () => {
  it('no-ops when both specs are empty', () => {
    expect(() => enforceNodeTypePolicy(FLOWS_FIXTURE, '', '')).not.toThrow();
  });

  it('blocks listed types', () => {
    expect(() => enforceNodeTypePolicy(FLOWS_FIXTURE, '', 'http request')).toThrow(
      /'http request' is blocked/,
    );
  });

  it('rejects types outside allowlist', () => {
    expect(() => enforceNodeTypePolicy(FLOWS_FIXTURE, 'inject,debug', '')).toThrow(
      /'http request' is not in ALLOWED_NODE_TYPES/,
    );
  });

  it('allowlist with all known types passes', () => {
    expect(() =>
      enforceNodeTypePolicy(FLOWS_FIXTURE, 'inject,debug,http request', ''),
    ).not.toThrow();
  });

  it('skips structural nodes (tab, group, comment, junction, subflow def)', () => {
    const flows: FlowsJson = [
      { id: 'tab1', type: 'tab', label: 'Main' },
      { id: 'g1', type: 'group', z: 'tab1', nodes: [] },
      { id: 'c1', type: 'comment', z: 'tab1', x: 50, y: 50 },
      { id: 'j1', type: 'junction', z: 'tab1', x: 60, y: 60, wires: [[]] },
      { id: 'sf1', type: 'subflow', name: 'S' },
      { id: 'n1', type: 'inject', z: 'tab1', x: 100, y: 100, wires: [[]] },
    ];
    // Even with a tiny allowlist, structural nodes shouldn't trip the policy.
    expect(() => enforceNodeTypePolicy(flows, 'inject', '')).not.toThrow();
  });
});
