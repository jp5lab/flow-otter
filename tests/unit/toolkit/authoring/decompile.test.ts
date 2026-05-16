import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../../../src/shared/canonical-json.js';
import { compile } from '../../../../src/toolkit/authoring/compile.js';
import { decompile } from '../../../../src/toolkit/authoring/decompile.js';
import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [
        { key: 'inj', type: 'inject', position: { x: 100, y: 100 } },
        { key: 'dbg', type: 'debug', position: { x: 300, y: 100 } },
      ],
      connections: [{ fromKey: 'inj', outputPort: 0, toKey: 'dbg' }],
      groups: [],
      comments: [],
    },
  ],
};

describe('decompile', () => {
  it('round-trips spec → flows → spec preserving structure', () => {
    const { flows } = compile(baseSpec);
    const back = decompile(flows);
    expect(back.tabs).toHaveLength(1);
    const tab = back.tabs[0];
    expect(tab?.id).toBe('tab-main');
    expect(tab?.label).toBe('Main');
    expect(tab?.nodes.map((n) => n.key).sort()).toEqual(['dbg', 'inj']);
    expect(tab?.connections).toEqual([{ fromKey: 'inj', outputPort: 0, toKey: 'dbg' }]);
  });

  it('compile(decompile(compile(spec))) yields identical bytes', () => {
    const first = compile(baseSpec);
    const back = decompile(first.flows);
    const second = compile(back, { prior: first.flows });
    expect(JSON.stringify(second.flows)).toBe(JSON.stringify(first.flows));
    expect(second.hash).toBe(first.hash);
  });

  it('handles flows authored without _authoringKey by falling back to id', () => {
    const flowsAuthoredInEditor = [
      { id: 'tabid', type: 'tab', label: 'X' },
      {
        id: 'node1',
        type: 'inject',
        z: 'tabid',
        x: 100,
        y: 100,
        wires: [[]],
      },
    ];
    const back = decompile(flowsAuthoredInEditor);
    expect(back.tabs[0]?.nodes[0]?.key).toBe('node1');
  });

  it('round-trips a subflow definition with body nodes byte-for-byte', () => {
    const specWithDef: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
      subflowDefs: [
        {
          id: 'def-A',
          name: 'MySub',
          nodes: [{ key: 'inner', type: 'function', position: { x: 100, y: 100 } }],
          connections: [],
          passthrough: { info: 'doc', category: 'utility' },
        },
      ],
    };
    const first = compile(specWithDef);
    const back = decompile(first.flows);
    expect(back.subflowDefs).toBeDefined();
    expect(back.subflowDefs).toHaveLength(1);
    expect(back.subflowDefs?.[0]?.id).toBe('def-A');
    expect(back.subflowDefs?.[0]?.name).toBe('MySub');
    expect(back.subflowDefs?.[0]?.nodes).toHaveLength(1);
    expect(back.subflowDefs?.[0]?.nodes[0]?.key).toBe('inner');

    const second = compile(back, { prior: first.flows });
    expect(canonicalJson(second.flows)).toBe(canonicalJson(first.flows));
  });

  it('round-trips a subflow instance on a tab byte-for-byte', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [
            {
              key: 'instA',
              type: 'subflow:def-A',
              position: { x: 200, y: 200 },
              passthrough: { env: [] },
            },
          ],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
      subflowDefs: [
        {
          id: 'def-A',
          name: 'Sub',
          nodes: [],
          connections: [],
        },
      ],
    };
    const first = compile(spec);
    const back = decompile(first.flows);
    const inst = back.tabs[0]?.nodes[0];
    expect(inst?.type).toBe('subflow:def-A');

    const second = compile(back, { prior: first.flows });
    expect(canonicalJson(second.flows)).toBe(canonicalJson(first.flows));
  });

  it('round-trips config nodes byte-for-byte', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
      configNodes: [
        {
          key: 'broker',
          type: 'mqtt-broker',
          label: 'Broker',
          passthrough: { broker: 'localhost', port: 1883 },
        },
      ],
    };
    const first = compile(spec);
    const back = decompile(first.flows);
    expect(back.configNodes).toHaveLength(1);
    expect(back.configNodes?.[0]?.key).toBe('broker');
    expect(back.configNodes?.[0]?.type).toBe('mqtt-broker');
    expect(back.configNodes?.[0]?.passthrough?.['broker']).toBe('localhost');

    const second = compile(back, { prior: first.flows });
    expect(canonicalJson(second.flows)).toBe(canonicalJson(first.flows));
  });

  it('preserves passthrough fields for new node types (mqtt, link, catch)', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [
            {
              key: 'm-in',
              type: 'mqtt in',
              position: { x: 100, y: 100 },
              passthrough: { topic: 'sensor/temp', qos: 1, broker: 'b1' },
            },
            {
              key: 'l-in',
              type: 'link in',
              position: { x: 100, y: 200 },
              passthrough: { links: ['l-out'] },
            },
            {
              key: 'c1',
              type: 'catch',
              position: { x: 100, y: 300 },
              passthrough: { scope: null },
            },
          ],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const first = compile(spec);
    const back = decompile(first.flows);
    const mqttIn = back.tabs[0]?.nodes.find((n) => n.key === 'm-in');
    expect(mqttIn?.passthrough?.['topic']).toBe('sensor/temp');
    expect(mqttIn?.passthrough?.['qos']).toBe(1);
    const linkIn = back.tabs[0]?.nodes.find((n) => n.key === 'l-in');
    expect(linkIn?.passthrough?.['links']).toEqual(['l-out']);
    const second = compile(back, { prior: first.flows });
    expect(canonicalJson(second.flows)).toBe(canonicalJson(first.flows));
  });

  it('strips runtime-built _users/_alias and inline credentials from passthrough', () => {
    // External writer (or older Node-RED export) put _users, _alias, and inline credentials
    // on the node. None of these should round-trip into the AuthoringSpec.
    const flows = [
      { id: 'tab1', type: 'tab', label: 'Main', _authoringKey: 'main' },
      {
        id: 'mqtt1',
        type: 'mqtt in',
        z: 'tab1',
        x: 100,
        y: 100,
        wires: [[]],
        name: 'broker',
        topic: 'sensor/temp',
        _users: ['user-a', 'user-b'],
        _alias: 'mqtt-1-alias',
        credentials: { user: 'admin', password: 'should-not-leak' },
        _authoringKey: 'mqtt-1',
      },
    ] as never;
    const spec = decompile(flows);
    const node = spec.tabs[0]?.nodes.find((n) => n.key === 'mqtt-1');
    expect(node).toBeDefined();
    expect(node?.passthrough).toBeDefined();
    expect(node?.passthrough?.['_users']).toBeUndefined();
    expect(node?.passthrough?.['_alias']).toBeUndefined();
    expect(node?.passthrough?.['credentials']).toBeUndefined();
    // Real fields still survive
    expect(node?.passthrough?.['topic']).toBe('sensor/temp');
  });
});
