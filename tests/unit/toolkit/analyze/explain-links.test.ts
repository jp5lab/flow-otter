import { describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../../../src/shared/flows-json.js';
import { explainFlow } from '../../../../src/toolkit/analyze/explain.js';

function baseTabs(): FlowsJson {
  return [
    { id: 'tab1', type: 'tab', label: 'Main' },
    { id: 'tab2', type: 'tab', label: 'Aux' },
  ] as FlowsJson;
}

describe('explainFlow link edges', () => {
  it('emits same-tab static link out edges without a cross-tab note', () => {
    const report = explainFlow(
      [
        ...baseTabs(),
        {
          id: 'lo1',
          type: 'link out',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [],
          links: ['li1'],
        },
        { id: 'li1', type: 'link in', z: 'tab1', x: 100, y: 0, wires: [[]], links: ['lo1'] },
      ] as FlowsJson,
      'tab1',
    );

    expect(report.edges).toEqual([{ fromId: 'lo1', outputPort: 0, toId: 'li1', kind: 'link' }]);
    expect(report.notes.some((note) => note.includes('Virtual link edge'))).toBe(false);
  });

  it('emits cross-tab static link edges and notes the target tab', () => {
    const report = explainFlow(
      [
        ...baseTabs(),
        {
          id: 'lo1',
          type: 'link out',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [],
          links: ['li2'],
        },
        { id: 'li2', type: 'link in', z: 'tab2', x: 100, y: 0, wires: [[]], links: ['lo1'] },
      ] as FlowsJson,
      'tab1',
    );

    expect(report.edges).toEqual([{ fromId: 'lo1', outputPort: 0, toId: 'li2', kind: 'link' }]);
    expect(report.notes).toContain("Virtual link edge lo1 -> li2 crosses to tab 'Aux'.");
  });

  it('emits symmetric cross-tab link edges when the on-tab node is the link in', () => {
    const report = explainFlow(
      [
        ...baseTabs(),
        {
          id: 'lo1',
          type: 'link out',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [],
          links: ['li2'],
        },
        { id: 'li2', type: 'link in', z: 'tab2', x: 100, y: 0, wires: [[]], links: ['lo1'] },
      ] as FlowsJson,
      'tab2',
    );

    expect(report.edges).toEqual([{ fromId: 'lo1', outputPort: 0, toId: 'li2', kind: 'link' }]);
    expect(report.notes).toContain("Virtual link edge lo1 -> li2 crosses to tab 'Main'.");
  });

  it('skips dynamic link nodes', () => {
    const report = explainFlow(
      [
        ...baseTabs(),
        {
          id: 'lo1',
          type: 'link out',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [],
          linkType: 'dynamic',
          links: ['li1'],
        },
        { id: 'li1', type: 'link in', z: 'tab1', x: 100, y: 0, wires: [[]], links: ['lo1'] },
      ] as FlowsJson,
      'tab1',
    );

    expect(report.edges).toEqual([]);
  });

  it('emits static link call node links as link edges', () => {
    const report = explainFlow(
      [
        ...baseTabs(),
        {
          id: 'lc1',
          type: 'link call',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          links: ['li1'],
        },
        { id: 'li1', type: 'link in', z: 'tab1', x: 100, y: 0, wires: [[]], links: ['lc1'] },
      ] as FlowsJson,
      'tab1',
    );

    expect(report.edges).toEqual([{ fromId: 'lc1', outputPort: 0, toId: 'li1', kind: 'link' }]);
  });

  it('emits function node.linkcall edges for literal targets by name and id', () => {
    const report = explainFlow(
      [
        ...baseTabs(),
        {
          id: 'fn1',
          type: 'function',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          func: "node.linkcall('Target Name', msg); node.linkcall('li2', msg);",
        },
        {
          id: 'li1',
          type: 'link in',
          z: 'tab1',
          x: 100,
          y: 0,
          wires: [[]],
          name: 'Target Name',
        },
        { id: 'li2', type: 'link in', z: 'tab2', x: 100, y: 0, wires: [[]], name: 'Other' },
      ] as FlowsJson,
      'tab1',
    );

    expect(report.edges).toEqual([
      { fromId: 'fn1', outputPort: 0, toId: 'li1', kind: 'linkcall' },
      { fromId: 'fn1', outputPort: 0, toId: 'li2', kind: 'linkcall' },
    ]);
    expect(report.notes).toContain("Virtual linkcall edge fn1 -> li2 crosses to tab 'Aux'.");
  });

  it('does not emit function node.linkcall edges for unresolved or non-literal targets', () => {
    const report = explainFlow(
      [
        ...baseTabs(),
        {
          id: 'fn1',
          type: 'function',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          func: "node.linkcall('missing', msg); node.linkcall(msg.target, msg);",
        },
        { id: 'li1', type: 'link in', z: 'tab1', x: 100, y: 0, wires: [[]], name: 'Target' },
      ] as FlowsJson,
      'tab1',
    );

    expect(report.edges).toEqual([]);
  });

  it('keeps wire edges tagged as wire', () => {
    const report = explainFlow(
      [
        ...baseTabs(),
        { id: 'in1', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [['debug1']] },
        { id: 'debug1', type: 'debug', z: 'tab1', x: 100, y: 0, wires: [] },
      ] as FlowsJson,
      'tab1',
    );

    expect(report.edges).toEqual([{ fromId: 'in1', outputPort: 0, toId: 'debug1', kind: 'wire' }]);
  });

  it('does not double-emit same-tab static links listed by both endpoints', () => {
    const report = explainFlow(
      [
        ...baseTabs(),
        {
          id: 'lo1',
          type: 'link out',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [],
          links: ['li1'],
        },
        { id: 'li1', type: 'link in', z: 'tab1', x: 100, y: 0, wires: [[]], links: ['lo1'] },
      ] as FlowsJson,
      'tab1',
    );

    expect(report.edges).toEqual([{ fromId: 'lo1', outputPort: 0, toId: 'li1', kind: 'link' }]);
  });
});
