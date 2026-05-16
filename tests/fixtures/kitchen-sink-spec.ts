import type { AuthoringSpec } from '../../src/toolkit/authoring/types.js';

const SUBFLOW_DEF_COMPILED_ID = 'b412ea0361d32c3f';

export const KITCHEN_SINK_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'main',
      label: 'Main',
      nodes: [
        {
          key: 'inject',
          type: 'inject',
          label: 'Inject',
          position: { x: 100, y: 100 },
          groupKey: 'main-group',
          passthrough: { props: [], once: false },
        },
        {
          key: 'function',
          type: 'function',
          label: 'Function',
          position: { x: 300, y: 100 },
          groupKey: 'main-group',
          passthrough: { func: 'return msg;', outputs: 2 },
        },
        {
          key: 'debug',
          type: 'debug',
          label: 'Debug',
          position: { x: 520, y: 100 },
          groupKey: 'main-group',
          passthrough: { complete: 'payload' },
        },
        {
          key: 'mqtt-in',
          type: 'mqtt in',
          label: 'MQTT In',
          position: { x: 100, y: 260 },
          passthrough: { topic: 'lab/in', qos: '0', datatype: 'auto' },
        },
        {
          key: 'mqtt-out',
          type: 'mqtt out',
          label: 'MQTT Out',
          position: { x: 520, y: 260 },
          passthrough: { topic: 'lab/out', qos: '0', retain: false },
        },
        {
          key: 'link-in',
          type: 'link in',
          label: 'Link In',
          position: { x: 100, y: 420 },
          passthrough: { links: [] },
        },
        {
          key: 'link-out',
          type: 'link out',
          label: 'Link Out',
          position: { x: 300, y: 420 },
          passthrough: { links: [], mode: 'link' },
        },
        {
          key: 'link-call',
          type: 'link call',
          label: 'Link Call',
          position: { x: 520, y: 420 },
          passthrough: { links: [], linkType: 'static' },
        },
        {
          key: 'catch',
          type: 'catch',
          label: 'Catch',
          position: { x: 100, y: 580 },
        },
        {
          key: 'status',
          type: 'status',
          label: 'Status',
          position: { x: 300, y: 580 },
        },
        {
          key: 'complete',
          type: 'complete',
          label: 'Complete',
          position: { x: 520, y: 580 },
        },
        {
          key: 'subflow-instance',
          type: `subflow:${SUBFLOW_DEF_COMPILED_ID}`,
          label: 'Subflow',
          position: { x: 740, y: 100 },
          passthrough: { env: [] },
        },
      ],
      connections: [
        { fromKey: 'inject', outputPort: 0, toKey: 'function' },
        { fromKey: 'function', outputPort: 0, toKey: 'debug' },
        { fromKey: 'function', outputPort: 1, toKey: 'mqtt-out' },
        { fromKey: 'mqtt-in', outputPort: 0, toKey: 'debug' },
        { fromKey: 'link-in', outputPort: 0, toKey: 'function' },
        { fromKey: 'link-call', outputPort: 0, toKey: 'debug' },
        { fromKey: 'catch', outputPort: 0, toKey: 'debug' },
        { fromKey: 'status', outputPort: 0, toKey: 'debug' },
        { fromKey: 'complete', outputPort: 0, toKey: 'debug' },
        { fromKey: 'subflow-instance', outputPort: 0, toKey: 'debug' },
      ],
      groups: [
        {
          key: 'main-group',
          name: 'Main Group',
          nodeKeys: ['inject', 'function', 'debug', 'overview-comment'],
          style: { fill: '#f6f6f6', label: true },
        },
      ],
      comments: [
        {
          key: 'overview-comment',
          text: 'Overview',
          position: { x: 100, y: 20 },
          info: 'Representative Milestone D kitchen-sink flow.',
          groupKey: 'main-group',
        },
      ],
    },
  ],
  subflowDefs: [
    {
      id: 'ks-subflow',
      name: 'Reusable',
      nodes: [
        {
          key: 'inner-function',
          type: 'function',
          label: 'Inner Function',
          position: { x: 160, y: 100 },
          passthrough: { func: 'return msg;', outputs: 1 },
        },
        {
          key: 'inner-debug',
          type: 'debug',
          label: 'Inner Debug',
          position: { x: 360, y: 100 },
        },
      ],
      connections: [{ fromKey: 'inner-function', outputPort: 0, toKey: 'inner-debug' }],
      passthrough: {
        in: [{ x: 40, y: 80, wires: [] }],
        out: [{ x: 620, y: 80, wires: [] }],
        info: 'Kitchen sink subflow definition.',
      },
    },
  ],
};
