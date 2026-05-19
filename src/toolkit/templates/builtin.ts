import { generateNodeId } from '../../shared/ids.js';
import type {
  AuthoringSpec,
  ConfigNodeSpec,
  ConnectionSpec,
  NodeSpec,
  SubflowDefSpec,
  TabSpec,
} from '../authoring/types.js';

import type { TemplateDefinition, TemplateParams } from './types.js';

/**
 * Find the authoring-key of the first existing config node of the given type
 * in the base spec. Used by Dashboard 2.0 widget templates so a follow-up
 * instantiation re-uses the skeleton's `ui-base`/`ui-page`/`ui-group`/`ui-theme`
 * instead of stamping out a duplicate hierarchy.
 */
function findExistingConfigKey(base: AuthoringSpec, type: string): string | undefined {
  return (base.configNodes ?? []).find((n) => n.type === type)?.key;
}

function stringParam(params: TemplateParams | undefined, name: string, fallback: string): string {
  const value = params?.[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function numberParam(params: TemplateParams | undefined, name: string, fallback: number): number {
  const value = params?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function unique(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function tabId(base: AuthoringSpec, desired: string): string {
  return unique(desired, new Set(base.tabs.map((t) => t.id)));
}

function configKey(base: AuthoringSpec, desired: string): string {
  return unique(desired, new Set((base.configNodes ?? []).map((n) => n.key)));
}

function subflowId(base: AuthoringSpec, desired: string): string {
  return unique(desired, new Set((base.subflowDefs ?? []).map((d) => d.id)));
}

function appendSpec(
  base: AuthoringSpec,
  add: Partial<AuthoringSpec> & { tabs?: readonly TabSpec[] },
): AuthoringSpec {
  return {
    ...base,
    tabs: [...base.tabs, ...(add.tabs ?? [])],
    ...((base.configNodes ?? add.configNodes) !== undefined
      ? { configNodes: [...(base.configNodes ?? []), ...(add.configNodes ?? [])] }
      : {}),
    ...((base.subflowDefs ?? add.subflowDefs) !== undefined
      ? { subflowDefs: [...(base.subflowDefs ?? []), ...(add.subflowDefs ?? [])] }
      : {}),
  };
}

function compiledTabId(tabKey: string): string {
  return generateNodeId(`tab:${tabKey}`);
}

function compiledConfigId(key: string): string {
  return generateNodeId(`config:${key}`);
}

function compiledNodeId(tabKey: string, nodeKey: string): string {
  return generateNodeId(`${compiledTabId(tabKey)}:node:${nodeKey}`);
}

function compiledSubflowDefId(defKey: string): string {
  return generateNodeId(`subflowDef:${defKey}`);
}

function simpleTab(
  id: string,
  label: string,
  nodes: readonly NodeSpec[],
  connections: TabSpec['connections'],
): TabSpec {
  return { id, label, nodes, connections, groups: [], comments: [] };
}

function brokerConfig(base: AuthoringSpec, keyBase: string): ConfigNodeSpec {
  const key = configKey(base, keyBase);
  return {
    key,
    type: 'mqtt-broker',
    label: 'Local Broker',
    passthrough: { broker: 'localhost', port: 1883 },
  };
}

interface SkeletonChain {
  readonly baseKey: string;
  readonly pageKey: string;
  readonly groupKey: string;
  readonly themeKey: string;
  readonly added: readonly ConfigNodeSpec[];
}

/**
 * Resolve the Dashboard 2.0 skeleton (ui-base / ui-page / ui-theme / ui-group)
 * keys against the base spec. Re-uses an existing config node of the right
 * type when present (composability with `dashboard_2_skeleton`); otherwise
 * declares a new one. The returned `added` list is what the caller should
 * pass into `appendSpec`'s `configNodes`.
 */
/**
 * Theme presets aligned with ISA-101 high-performance HMI guidance. Default
 * is `industrial` — muted grayscale base so saturated color reads as
 * "abnormal" instead of decoration. `flowfuse_default` preserves the
 * Dashboard 2.0 default cyan look for consumer-IoT use cases. `ops_dark` is
 * a dark variant for control-room environments.
 */
export type ThemePreset = 'industrial' | 'ops_dark' | 'flowfuse_default';

const THEME_PRESETS: Readonly<Record<ThemePreset, Readonly<Record<string, unknown>>>> =
  Object.freeze({
    industrial: {
      colors: {
        surface: '#ffffff',
        primary: '#404040',
        bgPage: '#dddddd',
        groupBg: '#f6f6f6',
        groupOutline: '#bbbbbb',
      },
      sizes: {
        density: 'compact',
        pagePadding: '12px',
        groupGap: '8px',
        groupBorderRadius: '2px',
        widgetGap: '8px',
      },
    },
    ops_dark: {
      colors: {
        surface: '#1a1f24',
        primary: '#3DDBD9',
        bgPage: '#0A0E12',
        groupBg: '#151B22',
        groupOutline: '#2A3441',
      },
      sizes: {
        density: 'compact',
        pagePadding: '16px',
        groupGap: '8px',
        groupBorderRadius: '2px',
        widgetGap: '8px',
      },
    },
    flowfuse_default: {
      colors: {
        surface: '#ffffff',
        primary: '#0094CE',
        bgPage: '#eeeeee',
        groupBg: '#ffffff',
        groupOutline: '#cccccc',
      },
    },
  });

function ensureSkeleton(
  base: AuthoringSpec,
  pageTitle: string,
  groupName: string,
  preset: ThemePreset = 'industrial',
): SkeletonChain {
  const added: ConfigNodeSpec[] = [];
  const taken = new Set((base.configNodes ?? []).map((n) => n.key));
  const reserve = (desired: string): string => {
    const k = unique(desired, taken);
    taken.add(k);
    return k;
  };

  let baseKey = findExistingConfigKey(base, 'ui-base');
  if (baseKey === undefined) {
    baseKey = reserve('ui-base');
    added.push({
      key: baseKey,
      type: 'ui-base',
      label: 'Dashboard',
      passthrough: { path: '/dashboard' },
    });
  }

  let themeKey = findExistingConfigKey(base, 'ui-theme');
  if (themeKey === undefined) {
    themeKey = reserve('ui-theme');
    added.push({
      key: themeKey,
      type: 'ui-theme',
      label: `Theme (${preset})`,
      passthrough: THEME_PRESETS[preset],
    });
  }

  let pageKey = findExistingConfigKey(base, 'ui-page');
  if (pageKey === undefined) {
    pageKey = reserve('ui-page');
    added.push({
      key: pageKey,
      type: 'ui-page',
      label: pageTitle,
      passthrough: {
        path: '/home',
        ui: compiledConfigId(baseKey),
        theme: compiledConfigId(themeKey),
        layout: 'grid',
      },
    });
  }

  let groupKey = findExistingConfigKey(base, 'ui-group');
  if (groupKey === undefined) {
    groupKey = reserve('ui-group');
    added.push({
      key: groupKey,
      type: 'ui-group',
      label: groupName,
      passthrough: { page: compiledConfigId(pageKey), width: 12 },
    });
  }

  return { baseKey, pageKey, groupKey, themeKey, added };
}

export const BUILTIN_TEMPLATES: readonly TemplateDefinition[] = [
  {
    name: 'hello_world',
    description: 'One tab with inject -> debug.',
    parameters: [
      { name: 'tab_label', type: 'string', description: 'Tab label.', default: 'Hello World' },
    ],
    instantiate: (base, params) => {
      const id = tabId(base, 'hello-world');
      const label = stringParam(params, 'tab_label', 'Hello World');
      return appendSpec(base, {
        tabs: [
          simpleTab(
            id,
            label,
            [
              { key: 'inject', type: 'inject', label: 'Tick', position: { x: 100, y: 100 } },
              { key: 'debug', type: 'debug', label: 'Debug', position: { x: 320, y: 100 } },
            ],
            [{ fromKey: 'inject', outputPort: 0, toKey: 'debug' }],
          ),
        ],
      });
    },
  },
  {
    name: 'mqtt_to_debug',
    description: 'MQTT input wired to debug, with a local broker config node.',
    parameters: [{ name: 'topic', type: 'string', description: 'MQTT topic.', default: 'lab/in' }],
    instantiate: (base, params) => {
      const id = tabId(base, 'mqtt-to-debug');
      const broker = brokerConfig(base, 'mqtt-broker');
      return appendSpec(base, {
        configNodes: [broker],
        tabs: [
          simpleTab(
            id,
            'MQTT To Debug',
            [
              {
                key: 'mqtt-in',
                type: 'mqtt in',
                label: 'MQTT In',
                position: { x: 100, y: 100 },
                passthrough: {
                  topic: stringParam(params, 'topic', 'lab/in'),
                  qos: '0',
                  broker: compiledConfigId(broker.key),
                },
              },
              { key: 'debug', type: 'debug', label: 'Debug', position: { x: 320, y: 100 } },
            ],
            [{ fromKey: 'mqtt-in', outputPort: 0, toKey: 'debug' }],
          ),
        ],
      });
    },
  },
  {
    name: 'inject_to_mqtt',
    description: 'Inject node publishes to MQTT, with a local broker config node.',
    parameters: [{ name: 'topic', type: 'string', description: 'MQTT topic.', default: 'lab/out' }],
    instantiate: (base, params) => {
      const id = tabId(base, 'inject-to-mqtt');
      const broker = brokerConfig(base, 'mqtt-broker');
      return appendSpec(base, {
        configNodes: [broker],
        tabs: [
          simpleTab(
            id,
            'Inject To MQTT',
            [
              { key: 'inject', type: 'inject', label: 'Publish', position: { x: 100, y: 100 } },
              {
                key: 'mqtt-out',
                type: 'mqtt out',
                label: 'MQTT Out',
                position: { x: 320, y: 100 },
                passthrough: {
                  topic: stringParam(params, 'topic', 'lab/out'),
                  qos: '0',
                  broker: compiledConfigId(broker.key),
                },
              },
            ],
            [{ fromKey: 'inject', outputPort: 0, toKey: 'mqtt-out' }],
          ),
        ],
      });
    },
  },
  {
    name: 'function_transform',
    description: 'Inject -> function transform -> debug.',
    parameters: [
      {
        name: 'function_name',
        type: 'string',
        description: 'Function label.',
        default: 'Transform',
      },
    ],
    instantiate: (base, params) => {
      const id = tabId(base, 'function-transform');
      return appendSpec(base, {
        tabs: [
          simpleTab(
            id,
            'Function Transform',
            [
              { key: 'inject', type: 'inject', label: 'Input', position: { x: 100, y: 100 } },
              {
                key: 'function',
                type: 'function',
                label: stringParam(params, 'function_name', 'Transform'),
                position: { x: 320, y: 100 },
                passthrough: {
                  func: 'msg.payload = { value: msg.payload };\nreturn msg;',
                  outputs: 1,
                },
              },
              { key: 'debug', type: 'debug', label: 'Output', position: { x: 560, y: 100 } },
            ],
            [
              { fromKey: 'inject', outputPort: 0, toKey: 'function' },
              { fromKey: 'function', outputPort: 0, toKey: 'debug' },
            ],
          ),
        ],
      });
    },
  },
  {
    name: 'link_call_pair',
    description: 'Link call targeting a link-in handler on the same tab.',
    parameters: [],
    instantiate: (base) => {
      const id = tabId(base, 'link-call-pair');
      return appendSpec(base, {
        tabs: [
          simpleTab(
            id,
            'Link Call Pair',
            [
              { key: 'inject', type: 'inject', label: 'Call', position: { x: 100, y: 100 } },
              {
                key: 'link-call',
                type: 'link call',
                label: 'Link Call',
                position: { x: 320, y: 100 },
                passthrough: { links: [compiledNodeId(id, 'link-in')] },
              },
              { key: 'link-in', type: 'link in', label: 'Handler', position: { x: 100, y: 260 } },
              { key: 'debug', type: 'debug', label: 'Handled', position: { x: 320, y: 260 } },
            ],
            [
              { fromKey: 'inject', outputPort: 0, toKey: 'link-call' },
              { fromKey: 'link-in', outputPort: 0, toKey: 'debug' },
            ],
          ),
        ],
      });
    },
  },
  {
    name: 'error_monitor',
    description: 'Catch node wired to debug for error visibility.',
    parameters: [],
    instantiate: (base) => {
      const id = tabId(base, 'error-monitor');
      return appendSpec(base, {
        tabs: [
          simpleTab(
            id,
            'Error Monitor',
            [
              { key: 'catch', type: 'catch', label: 'Catch', position: { x: 100, y: 100 } },
              { key: 'debug', type: 'debug', label: 'Errors', position: { x: 320, y: 100 } },
            ],
            [{ fromKey: 'catch', outputPort: 0, toKey: 'debug' }],
          ),
        ],
      });
    },
  },
  {
    name: 'status_monitor',
    description: 'Status node wired to debug.',
    parameters: [],
    instantiate: (base) => {
      const id = tabId(base, 'status-monitor');
      return appendSpec(base, {
        tabs: [
          simpleTab(
            id,
            'Status Monitor',
            [
              { key: 'status', type: 'status', label: 'Status', position: { x: 100, y: 100 } },
              { key: 'debug', type: 'debug', label: 'Status Debug', position: { x: 320, y: 100 } },
            ],
            [{ fromKey: 'status', outputPort: 0, toKey: 'debug' }],
          ),
        ],
      });
    },
  },
  {
    name: 'complete_monitor',
    description: 'Complete node wired to debug.',
    parameters: [],
    instantiate: (base) => {
      const id = tabId(base, 'complete-monitor');
      return appendSpec(base, {
        tabs: [
          simpleTab(
            id,
            'Complete Monitor',
            [
              {
                key: 'complete',
                type: 'complete',
                label: 'Complete',
                position: { x: 100, y: 100 },
              },
              {
                key: 'debug',
                type: 'debug',
                label: 'Complete Debug',
                position: { x: 320, y: 100 },
              },
            ],
            [{ fromKey: 'complete', outputPort: 0, toKey: 'debug' }],
          ),
        ],
      });
    },
  },
  {
    name: 'reusable_subflow',
    description: 'Subflow definition plus one workspace instance.',
    parameters: [],
    instantiate: (base) => {
      const tab = tabId(base, 'reusable-subflow');
      const def = subflowId(base, 'reusable-subflow-def');
      const subflowDef: SubflowDefSpec = {
        id: def,
        name: 'Reusable',
        nodes: [
          {
            key: 'inner-function',
            type: 'function',
            label: 'Inner Function',
            position: { x: 140, y: 100 },
            passthrough: { func: 'return msg;', outputs: 1 },
          },
        ],
        connections: [],
        passthrough: { out: [{ x: 420, y: 80, wires: [] }] },
      };
      return appendSpec(base, {
        subflowDefs: [subflowDef],
        tabs: [
          simpleTab(
            tab,
            'Reusable Subflow',
            [
              { key: 'inject', type: 'inject', label: 'Input', position: { x: 100, y: 100 } },
              {
                key: 'subflow-instance',
                type: `subflow:${compiledSubflowDefId(def)}`,
                label: 'Reusable',
                position: { x: 320, y: 100 },
              },
              { key: 'debug', type: 'debug', label: 'Output', position: { x: 560, y: 100 } },
            ],
            [
              { fromKey: 'inject', outputPort: 0, toKey: 'subflow-instance' },
              { fromKey: 'subflow-instance', outputPort: 0, toKey: 'debug' },
            ],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_skeleton',
    description: 'Dashboard 2.0 skeleton: ui-base + ui-page + ui-theme + ui-group, no widgets.',
    parameters: [
      { name: 'title', type: 'string', description: 'Page title.', default: 'Dashboard' },
      { name: 'group_name', type: 'string', description: 'Default group name.', default: 'Main' },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Dashboard');
      const groupName = stringParam(params, 'group_name', 'Main');
      const skel = ensureSkeleton(base, title, groupName);
      return appendSpec(base, { configNodes: skel.added });
    },
  },
  {
    name: 'dashboard_2_status_panel',
    description: 'Dashboard 2.0 skeleton + one ui-text widget reading {{msg.payload}}.',
    parameters: [{ name: 'title', type: 'string', description: 'Page title.', default: 'Status' }],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Status');
      const skel = ensureSkeleton(base, title, 'Status');
      const tab = tabId(base, 'dashboard-2-status-panel');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Dashboard Status',
            [
              {
                key: 'status-text',
                type: 'ui-text',
                label: 'Status',
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: { label: 'Status', format: '{{msg.payload}}', layout: 'row-left' },
              },
            ],
            [],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_telemetry_chart',
    description: 'Dashboard 2.0 skeleton + ui-chart line plot on a time-axis.',
    parameters: [
      { name: 'title', type: 'string', description: 'Chart label.', default: 'Telemetry' },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Telemetry');
      const skel = ensureSkeleton(base, title, 'Charts');
      const tab = tabId(base, 'dashboard-2-telemetry-chart');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Telemetry Chart',
            [
              {
                key: 'telemetry-chart',
                type: 'ui-chart',
                label: title,
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  label: title,
                  chartType: 'line',
                  category: 'topic',
                  xAxisType: 'time',
                  xAxisFormat: 'auto',
                  action: 'append',
                  pointShape: 'circle',
                  pointRadius: 2,
                  showLegend: true,
                  width: 12,
                  height: 6,
                },
              },
            ],
            [],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_command_panel',
    description:
      'Dashboard 2.0 skeleton + ui-button-group + ui-text + ui-notification (start/stop/abort).',
    parameters: [
      { name: 'title', type: 'string', description: 'Page title.', default: 'Bring-up' },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Bring-up');
      const skel = ensureSkeleton(base, title, 'Commands');
      const tab = tabId(base, 'dashboard-2-command-panel');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Command Panel',
            [
              {
                key: 'cmd-buttons',
                type: 'ui-button-group',
                label: 'Commands',
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  label: 'Commands',
                  topic: 'cmd',
                  topicType: 'str',
                  payload: '',
                  payloadType: 'str',
                  options: [
                    { label: 'Start', value: 'start', icon: 'mdi-play', color: 'success' },
                    { label: 'Stop', value: 'stop', icon: 'mdi-stop', color: 'warning' },
                    { label: 'Abort', value: 'abort', icon: 'mdi-cancel', color: 'error' },
                  ],
                  width: 12,
                  height: 1,
                },
              },
              {
                key: 'cmd-status',
                type: 'ui-text',
                label: 'Last Action',
                position: { x: 160, y: 220 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  label: 'Last Action',
                  format: '{{msg.payload}}',
                  layout: 'row-left',
                  width: 12,
                  height: 1,
                },
              },
              {
                key: 'cmd-toast',
                type: 'ui-notification',
                label: 'Toast',
                position: { x: 160, y: 340 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  position: 'top right',
                  color: '#0094CE',
                  displayTime: 4,
                  allowDismiss: true,
                  topic: 'cmd-result',
                },
              },
            ],
            [
              { fromKey: 'cmd-buttons', outputPort: 0, toKey: 'cmd-status' },
              { fromKey: 'cmd-buttons', outputPort: 0, toKey: 'cmd-toast' },
            ],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_form_input',
    description:
      'Dashboard 2.0 skeleton + ui-form with three typed fields wired into a function and debug.',
    parameters: [
      { name: 'title', type: 'string', description: 'Form title.', default: 'Session Metadata' },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Session Metadata');
      const skel = ensureSkeleton(base, title, 'Forms');
      const tab = tabId(base, 'dashboard-2-form-input');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Form Input',
            [
              {
                key: 'session-form',
                type: 'ui-form',
                label: title,
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  label: title,
                  topic: 'session/meta',
                  topicType: 'str',
                  payload: '',
                  payloadType: 'msg',
                  options: [
                    { label: 'Operator', key: 'operator', type: 'text', required: true },
                    { label: 'Notes', key: 'notes', type: 'multiline', rows: 3, required: false },
                    { label: 'Session #', key: 'session', type: 'number', required: true },
                  ],
                  splitLayout: false,
                  submit: 'Save',
                  cancel: 'Reset',
                  resetOnSubmit: true,
                  width: 12,
                  height: 6,
                },
              },
              {
                key: 'shape-form',
                type: 'function',
                label: 'Shape Submission',
                position: { x: 460, y: 100 },
                passthrough: {
                  func: 'msg.payload = { kind: "session-meta", body: msg.payload };\nreturn msg;',
                  outputs: 1,
                },
              },
              {
                key: 'form-debug',
                type: 'debug',
                label: 'Form Debug',
                position: { x: 720, y: 100 },
              },
            ],
            [
              { fromKey: 'session-form', outputPort: 0, toKey: 'shape-form' },
              { fromKey: 'shape-form', outputPort: 0, toKey: 'form-debug' },
            ],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_gauge_grid',
    description:
      'Dashboard 2.0 skeleton + four ui-gauge widgets (generic process metrics) in a 12-column group.',
    parameters: [],
    instantiate: (base) => {
      const skel = ensureSkeleton(base, 'Gauges', 'Telemetry');
      const tab = tabId(base, 'dashboard-2-gauge-grid');
      const widgets: NodeSpec[] = [
        {
          metric: 'temperature',
          label: 'Temperature',
          units: '°C',
          min: -20,
          max: 120,
        },
        {
          metric: 'pressure',
          label: 'Pressure',
          units: 'bar',
          min: 0,
          max: 10,
        },
        {
          metric: 'flow',
          label: 'Flow',
          units: 'L/min',
          min: 0,
          max: 100,
        },
        {
          metric: 'level',
          label: 'Level',
          units: '%',
          min: 0,
          max: 100,
        },
      ].map((g, i) => ({
        key: `gauge-${g.metric}`,
        type: 'ui-gauge',
        label: g.label,
        position: { x: 160, y: 100 + i * 120 },
        widgetAnchor: { kind: 'group', refKey: skel.groupKey },
        passthrough: {
          label: g.label,
          gtype: 'gauge',
          min: g.min,
          max: g.max,
          units: g.units,
          width: 3,
          height: 3,
          order: i + 1,
          colorScheme: 'default',
        },
      }));
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [simpleTab(tab, 'Gauge Grid', widgets, [])],
      });
    },
  },
  {
    name: 'dashboard_2_table_log',
    description: 'Dashboard 2.0 skeleton + ui-table listening to msg.payload arrays.',
    parameters: [
      { name: 'title', type: 'string', description: 'Table label.', default: 'Event Log' },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Event Log');
      const skel = ensureSkeleton(base, title, 'Logs');
      const tab = tabId(base, 'dashboard-2-table-log');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Table Log',
            [
              {
                key: 'event-table',
                type: 'ui-table',
                label: title,
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  label: title,
                  columns: [
                    { key: 'timestamp', label: 'Time' },
                    { key: 'level', label: 'Level' },
                    { key: 'message', label: 'Message' },
                  ],
                  selectionMode: 'none',
                  pageSize: 25,
                  showSearch: true,
                  density: 'comfortable',
                  width: 12,
                  height: 8,
                },
              },
            ],
            [],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_dual_theme',
    description:
      'Dashboard 2.0 skeleton with two ui-theme nodes (light/dark) + ui-control + ui-button toggle.',
    parameters: [],
    instantiate: (base) => {
      const skel = ensureSkeleton(base, 'Dual Theme', 'Theme Toggle');
      const darkKey = configKey(appendSpec(base, { configNodes: skel.added }), 'ui-theme-dark');
      const darkTheme: ConfigNodeSpec = {
        key: darkKey,
        type: 'ui-theme',
        label: 'Dark Theme',
        passthrough: {
          colors: {
            surface: '#1e1e1e',
            primary: '#90CAF9',
            bgPage: '#121212',
            groupBg: '#2c2c2c',
            groupOutline: '#444444',
          },
        },
      };
      const tab = tabId(base, 'dashboard-2-dual-theme');
      return appendSpec(base, {
        configNodes: [...skel.added, darkTheme],
        tabs: [
          simpleTab(
            tab,
            'Dual Theme',
            [
              {
                key: 'theme-button',
                type: 'ui-button',
                label: 'Toggle Theme',
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  label: 'Toggle Theme',
                  icon: 'mdi-theme-light-dark',
                  topic: 'ui-control',
                  topicType: 'str',
                  payload: 'theme',
                  payloadType: 'str',
                  width: 6,
                  height: 1,
                },
              },
              {
                key: 'theme-control',
                type: 'ui-control',
                label: 'Theme Control',
                position: { x: 460, y: 100 },
                passthrough: {},
              },
            ],
            [{ fromKey: 'theme-button', outputPort: 0, toKey: 'theme-control' }],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_multi_page',
    description:
      'Dashboard 2.0 with one ui-base and three ui-pages (Overview / Phase-Bringup / Charts), each with its own group.',
    parameters: [],
    instantiate: (base) => {
      const taken = new Set((base.configNodes ?? []).map((n) => n.key));
      const reserve = (desired: string): string => {
        const k = unique(desired, taken);
        taken.add(k);
        return k;
      };

      const baseKey = findExistingConfigKey(base, 'ui-base') ?? reserve('ui-base');
      const themeKey = findExistingConfigKey(base, 'ui-theme') ?? reserve('ui-theme');
      const overviewPageKey = reserve('ui-page-overview');
      const bringupPageKey = reserve('ui-page-bringup');
      const chartsPageKey = reserve('ui-page-charts');
      const overviewGroupKey = reserve('ui-group-overview');
      const bringupGroupKey = reserve('ui-group-bringup');
      const chartsGroupKey = reserve('ui-group-charts');

      const newConfigs: ConfigNodeSpec[] = [];
      if (findExistingConfigKey(base, 'ui-base') === undefined) {
        newConfigs.push({
          key: baseKey,
          type: 'ui-base',
          label: 'Dashboard',
          passthrough: { path: '/dashboard' },
        });
      }
      if (findExistingConfigKey(base, 'ui-theme') === undefined) {
        newConfigs.push({
          key: themeKey,
          type: 'ui-theme',
          label: 'Default Theme',
          passthrough: {
            colors: {
              surface: '#ffffff',
              primary: '#0094CE',
              bgPage: '#eeeeee',
              groupBg: '#ffffff',
              groupOutline: '#cccccc',
            },
          },
        });
      }
      newConfigs.push(
        {
          key: overviewPageKey,
          type: 'ui-page',
          label: 'Overview',
          passthrough: {
            path: '/overview',
            ui: compiledConfigId(baseKey),
            theme: compiledConfigId(themeKey),
            layout: 'grid',
          },
        },
        {
          key: bringupPageKey,
          type: 'ui-page',
          label: 'Phase-Bringup',
          passthrough: {
            path: '/bringup',
            ui: compiledConfigId(baseKey),
            theme: compiledConfigId(themeKey),
            layout: 'grid',
          },
        },
        {
          key: chartsPageKey,
          type: 'ui-page',
          label: 'Charts',
          passthrough: {
            path: '/charts',
            ui: compiledConfigId(baseKey),
            theme: compiledConfigId(themeKey),
            layout: 'grid',
          },
        },
        {
          key: overviewGroupKey,
          type: 'ui-group',
          label: 'Overview',
          passthrough: { page: compiledConfigId(overviewPageKey), width: 12 },
        },
        {
          key: bringupGroupKey,
          type: 'ui-group',
          label: 'Bring-up',
          passthrough: { page: compiledConfigId(bringupPageKey), width: 12 },
        },
        {
          key: chartsGroupKey,
          type: 'ui-group',
          label: 'Charts',
          passthrough: { page: compiledConfigId(chartsPageKey), width: 12 },
        },
      );

      const tab = tabId(base, 'dashboard-2-multi-page');
      return appendSpec(base, {
        configNodes: newConfigs,
        tabs: [
          simpleTab(
            tab,
            'Multi-Page Dashboard',
            [
              {
                key: 'overview-text',
                type: 'ui-text',
                label: 'Overview',
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: overviewGroupKey },
                passthrough: { label: 'Status', format: '{{msg.payload}}', layout: 'row-left' },
              },
              {
                key: 'bringup-text',
                type: 'ui-text',
                label: 'Bring-up',
                position: { x: 160, y: 220 },
                widgetAnchor: { kind: 'group', refKey: bringupGroupKey },
                passthrough: { label: 'Phase', format: '{{msg.payload}}', layout: 'row-left' },
              },
              {
                key: 'charts-text',
                type: 'ui-text',
                label: 'Charts',
                position: { x: 160, y: 340 },
                widgetAnchor: { kind: 'group', refKey: chartsGroupKey },
                passthrough: { label: 'Series', format: '{{msg.payload}}', layout: 'row-left' },
              },
            ],
            [],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_template_widget',
    description:
      'Dashboard 2.0 skeleton + one ui-template with a Vue 3 component scaffold (templateScope=widget:group).',
    parameters: [
      { name: 'title', type: 'string', description: 'Widget title.', default: 'Custom Widget' },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Custom Widget');
      const skel = ensureSkeleton(base, title, 'Custom');
      const tab = tabId(base, 'dashboard-2-template-widget');
      const vueBody = [
        '<template>',
        '  <v-card class="pa-3">',
        '    <v-card-title>{{ title }}</v-card-title>',
        '    <v-card-text>',
        '      <pre>{{ msg && msg.payload }}</pre>',
        '      <v-btn color="primary" @click="ping">Ping</v-btn>',
        '    </v-card-text>',
        '  </v-card>',
        '</template>',
        '<script>',
        'export default {',
        '  data() { return { title: "Custom Widget" } },',
        '  watch: {',
        '    msg: { handler(m) { /* react to inbound msg */ }, deep: true },',
        '  },',
        '  methods: {',
        '    ping() { this.send({ payload: { from: this.id, t: "ping" } }) },',
        '  },',
        '}',
        '</script>',
      ].join('\n');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Template Widget',
            [
              {
                key: 'custom-widget',
                type: 'ui-template',
                label: title,
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  templateScope: 'widget:group',
                  format: vueBody,
                  width: 6,
                  height: 4,
                },
              },
            ],
            [],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_custom_css',
    description:
      'Dashboard 2.0 ui-template with templateScope=site:style and a CSS body (no widget surface).',
    parameters: [],
    instantiate: (base) => {
      const taken = new Set((base.configNodes ?? []).map((n) => n.key));
      const reserve = (desired: string): string => {
        const k = unique(desired, taken);
        taken.add(k);
        return k;
      };
      const baseKey = findExistingConfigKey(base, 'ui-base') ?? reserve('ui-base');
      const newConfigs: ConfigNodeSpec[] = [];
      if (findExistingConfigKey(base, 'ui-base') === undefined) {
        newConfigs.push({
          key: baseKey,
          type: 'ui-base',
          label: 'Dashboard',
          passthrough: { path: '/dashboard' },
        });
      }
      const cssBody = [
        '/* Site-wide custom styling */',
        ':root {',
        '  --nrdb-ui-bg-page: #eeeeee;',
        '  --nrdb-ui-group-bg: #ffffff;',
        '}',
        '.nrdb-ui-widget { letter-spacing: 0.01em; }',
      ].join('\n');
      const tab = tabId(base, 'dashboard-2-custom-css');
      return appendSpec(base, {
        configNodes: newConfigs,
        tabs: [
          simpleTab(
            tab,
            'Custom CSS',
            [
              {
                key: 'site-style',
                type: 'ui-template',
                label: 'Site Style',
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'ui', refKey: baseKey },
                passthrough: {
                  templateScope: 'site:style',
                  format: cssBody,
                },
              },
            ],
            [],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_alarm_panel',
    description:
      'Dashboard 2.0 skeleton + ui-table alarm list driven by an ISA-18.2 state-machine function node. Subscribes to "alarms/+/+" MQTT topic convention. State machine tracks UNACK/ACK/RTN/SHELVED transitions on msg.payload.{id,priority,source,state,ts}.',
    parameters: [
      { name: 'title', type: 'string', description: 'Panel title.', default: 'Active Alarms' },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Active Alarms');
      const skel = ensureSkeleton(base, title, 'Alarms');
      const tab = tabId(base, 'dashboard-2-alarm-panel');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Alarms',
            [
              {
                key: 'alarm-state-machine',
                type: 'function',
                label: 'ISA-18.2 state',
                position: { x: 160, y: 100 },
                ...(skel.groupKey !== undefined ? { groupKey: skel.groupKey } : {}),
                passthrough: {
                  func: [
                    '// ISA-18.2 alarm state machine — tracks {id,priority,source,state,ts}',
                    '// Input msg.payload: { id, priority, source, value?, ack?, shelve? }',
                    '// state ∈ {UNACK, ACK, RTN, SHELVED}',
                    'const store = context.get("alarms") || {};',
                    'const p = msg.payload || {};',
                    'if (!p.id) { node.warn("alarm missing id"); return null; }',
                    'const prior = store[p.id];',
                    'const now = Date.now();',
                    'let state = prior?.state || "UNACK";',
                    'if (p.shelve === true) state = "SHELVED";',
                    'else if (p.ack === true) state = prior?.state === "RTN" ? "RTN" : "ACK";',
                    'else if (p.value === undefined || p.value === false) state = prior?.state === "ACK" ? "RTN" : state;',
                    'else state = "UNACK";',
                    'store[p.id] = { ...p, state, ts: now };',
                    'context.set("alarms", store);',
                    'msg.payload = Object.values(store).sort((a,b) => (a.priority||3) - (b.priority||3));',
                    'return msg;',
                  ].join('\n'),
                  outputs: 1,
                  noerr: 0,
                  initialize: '',
                  finalize: '',
                },
              },
              {
                key: 'alarm-table',
                type: 'ui-table',
                label: title,
                position: { x: 400, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  label: title,
                  columns: [
                    { key: 'priority', title: 'P', width: '40px' },
                    { key: 'state', title: 'State', width: '90px' },
                    { key: 'source', title: 'Source' },
                    { key: 'id', title: 'Alarm' },
                    { key: 'ts', title: 'Since', width: '160px' },
                  ],
                  selectionMode: 'single',
                  pageSize: 20,
                  showSearch: true,
                  density: 'compact',
                  width: 12,
                  height: 6,
                },
              },
            ],
            [{ fromKey: 'alarm-state-machine', outputPort: 0, toKey: 'alarm-table' }],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_confirmed_button',
    description:
      'Dashboard 2.0 skeleton + ui-template that renders a hold-2-seconds-to-confirm destructive button. Use for stop / abort / e-stop / shutdown / reset actions where a single mis-tap is unsafe.',
    parameters: [
      { name: 'title', type: 'string', description: 'Button label.', default: 'Abort' },
      {
        name: 'topic',
        type: 'string',
        description: 'MQTT topic on confirm.',
        default: 'cmd/abort',
      },
      { name: 'hold_ms', type: 'number', description: 'Milliseconds to hold.', default: 2000 },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Abort');
      const topic = stringParam(params, 'topic', 'cmd/abort');
      const holdMs = numberParam(params, 'hold_ms', 2000);
      const skel = ensureSkeleton(base, title, 'Critical Actions');
      const tab = tabId(base, 'dashboard-2-confirmed-button');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Confirmed Button',
            [
              {
                key: 'confirmed-btn',
                type: 'ui-template',
                label: title,
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  templateScope: 'local',
                  format: [
                    `<template>`,
                    `  <v-btn :color="armed ? 'error' : 'warning'"`,
                    `         block large`,
                    `         @pointerdown="start" @pointerup="cancel" @pointerleave="cancel">`,
                    `    <span v-if="!armed">{{ label }} (hold)</span>`,
                    `    <span v-else>RELEASING in {{ remaining }}s</span>`,
                    `  </v-btn>`,
                    `</template>`,
                    `<script>`,
                    `export default {`,
                    `  data() { return { armed: false, remaining: 0, timer: null, label: '${title.replace(/'/g, "\\'")}', holdMs: ${holdMs} } },`,
                    `  methods: {`,
                    `    start() {`,
                    `      this.armed = true; this.remaining = (this.holdMs/1000).toFixed(1);`,
                    `      const startedAt = Date.now();`,
                    `      this.timer = setInterval(() => {`,
                    `        const elapsed = Date.now() - startedAt;`,
                    `        this.remaining = ((this.holdMs - elapsed)/1000).toFixed(1);`,
                    `        if (elapsed >= this.holdMs) { this.fire(); }`,
                    `      }, 100);`,
                    `    },`,
                    `    cancel() { clearInterval(this.timer); this.armed = false; this.remaining = 0; },`,
                    `    fire() { clearInterval(this.timer); this.armed = false; this.send({ payload: 'confirmed', topic: '${topic}', confirmed_at: Date.now() }); },`,
                    `  },`,
                    `}`,
                    `</script>`,
                  ].join('\n'),
                  width: 6,
                  height: 2,
                },
              },
            ],
            [],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_mode_banner',
    description:
      'Dashboard 2.0 skeleton + ui-template mode banner. Renders AUTO/MANUAL + LOCAL/REMOTE + LOCKOUT state from msg.payload.{mode,access,lockout}. Grayscale base, saturated red only when LOCKOUT is true.',
    parameters: [
      { name: 'title', type: 'string', description: 'Banner title.', default: 'System Status' },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'System Status');
      const skel = ensureSkeleton(base, title, 'Status');
      const tab = tabId(base, 'dashboard-2-mode-banner');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Mode Banner',
            [
              {
                key: 'mode-banner',
                type: 'ui-template',
                label: title,
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  templateScope: 'local',
                  format: [
                    `<template>`,
                    `  <div :style="bannerStyle">`,
                    `    <span class="chip">{{ mode || 'UNKNOWN' }}</span>`,
                    `    <span class="chip">{{ access || 'LOCAL' }}</span>`,
                    `    <span v-if="lockout" class="chip lockout">LOCKOUT</span>`,
                    `  </div>`,
                    `</template>`,
                    `<script>`,
                    `export default {`,
                    `  data() { return { mode: '', access: '', lockout: false } },`,
                    `  watch: { msg(m) {`,
                    `    if (!m || !m.payload) return;`,
                    `    this.mode = (m.payload.mode || '').toUpperCase();`,
                    `    this.access = (m.payload.access || '').toUpperCase();`,
                    `    this.lockout = !!m.payload.lockout;`,
                    `  }},`,
                    `  computed: { bannerStyle() {`,
                    `    return { display:'flex', gap:'12px', padding:'8px 12px',`,
                    `             background: this.lockout ? '#b00020' : '#404040', color:'#fff', fontWeight: 600,`,
                    `             fontFamily: 'monospace', letterSpacing: '0.04em' };`,
                    `  }},`,
                    `}`,
                    `</script>`,
                    `<style scoped>`,
                    `.chip { padding: 2px 8px; background: rgba(255,255,255,0.12); border-radius: 2px; }`,
                    `.lockout { background: #fff; color: #b00020; }`,
                    `</style>`,
                  ].join('\n'),
                  width: 12,
                  height: 1,
                },
              },
            ],
            [],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_live_value',
    description:
      'Dashboard 2.0 skeleton + ui-template wrapping a numeric/text value with a stale-data badge. Shows grayed-out value when no msg.payload received within `stale_after_ms` (default 5000). Pairs with any telemetry source.',
    parameters: [
      { name: 'label', type: 'string', description: 'Value label.', default: 'Telemetry' },
      { name: 'units', type: 'string', description: 'Units suffix.', default: '' },
      {
        name: 'stale_after_ms',
        type: 'number',
        description: 'ms before stale badge.',
        default: 5000,
      },
    ],
    instantiate: (base, params) => {
      const label = stringParam(params, 'label', 'Telemetry');
      const units = stringParam(params, 'units', '');
      const staleMs = numberParam(params, 'stale_after_ms', 5000);
      const skel = ensureSkeleton(base, label, 'Live Values');
      const tab = tabId(base, 'dashboard-2-live-value');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Live Value',
            [
              {
                key: 'live-value',
                type: 'ui-template',
                label,
                position: { x: 160, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  templateScope: 'local',
                  format: [
                    `<template>`,
                    `  <div :class="['lv', stale && 'stale']">`,
                    `    <div class="label">${label.replace(/`/g, '')}</div>`,
                    `    <div class="value">{{ formatted }}<span class="units"> ${units.replace(/`/g, '')}</span></div>`,
                    `    <div v-if="stale" class="badge">STALE (last update {{ secsAgo }}s ago)</div>`,
                    `  </div>`,
                    `</template>`,
                    `<script>`,
                    `export default {`,
                    `  data() { return { value: null, lastTs: null, now: Date.now(), staleMs: ${staleMs}, timer: null } },`,
                    `  mounted() { this.timer = setInterval(() => { this.now = Date.now(); }, 1000); },`,
                    `  beforeDestroy() { clearInterval(this.timer); },`,
                    `  watch: { msg(m) { if (m && m.payload !== undefined) { this.value = m.payload; this.lastTs = Date.now(); } } },`,
                    `  computed: {`,
                    `    stale() { return this.lastTs === null || (this.now - this.lastTs) > this.staleMs; },`,
                    `    secsAgo() { return this.lastTs === null ? '?' : Math.floor((this.now - this.lastTs)/1000); },`,
                    `    formatted() { if (this.value === null) return '—'; if (typeof this.value === 'number') return this.value.toFixed(2); return String(this.value); },`,
                    `  },`,
                    `}`,
                    `</script>`,
                    `<style scoped>`,
                    `.lv { display: flex; flex-direction: column; gap: 4px; padding: 8px; }`,
                    `.label { font-size: 0.8em; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }`,
                    `.value { font-size: 2em; font-variant-numeric: tabular-nums; font-family: monospace; }`,
                    `.units { font-size: 0.6em; color: #888; margin-left: 4px; }`,
                    `.badge { font-size: 0.7em; color: #b00020; background: #fff3e0; padding: 2px 6px; border-radius: 2px; align-self: flex-start; }`,
                    `.stale .value { color: #999; }`,
                    `</style>`,
                  ].join('\n'),
                  width: 4,
                  height: 2,
                },
              },
            ],
            [],
          ),
        ],
      });
    },
  },
  {
    name: 'dashboard_2_audit_log_tail',
    description:
      'Dashboard 2.0 skeleton + ui-table showing the last N operator actions from a topic-driven msg.payload stream. Operator-visible "what just happened" surface, separate from the FlowOtter-server-side audit log.',
    parameters: [
      { name: 'title', type: 'string', description: 'Panel title.', default: 'Recent Actions' },
      { name: 'limit', type: 'number', description: 'How many rows to retain.', default: 50 },
    ],
    instantiate: (base, params) => {
      const title = stringParam(params, 'title', 'Recent Actions');
      const limit = numberParam(params, 'limit', 50);
      const skel = ensureSkeleton(base, title, 'Audit');
      const tab = tabId(base, 'dashboard-2-audit-log-tail');
      return appendSpec(base, {
        configNodes: skel.added,
        tabs: [
          simpleTab(
            tab,
            'Audit Log Tail',
            [
              {
                key: 'audit-buffer',
                type: 'function',
                label: 'tail buffer',
                position: { x: 160, y: 100 },
                ...(skel.groupKey !== undefined ? { groupKey: skel.groupKey } : {}),
                passthrough: {
                  func: [
                    '// Operator audit-log tail: keep last N entries in flow context.',
                    `const limit = ${limit};`,
                    'const buf = context.get("audit_tail") || [];',
                    'const e = msg.payload;',
                    'if (e && typeof e === "object") {',
                    '  buf.unshift({ ts: new Date().toISOString(), ...e });',
                    '  while (buf.length > limit) buf.pop();',
                    '  context.set("audit_tail", buf);',
                    '}',
                    'msg.payload = buf;',
                    'return msg;',
                  ].join('\n'),
                  outputs: 1,
                },
              },
              {
                key: 'audit-table',
                type: 'ui-table',
                label: title,
                position: { x: 400, y: 100 },
                widgetAnchor: { kind: 'group', refKey: skel.groupKey },
                passthrough: {
                  label: title,
                  columns: [
                    { key: 'ts', title: 'When', width: '160px' },
                    { key: 'actor', title: 'Who', width: '120px' },
                    { key: 'action', title: 'Action' },
                    { key: 'detail', title: 'Detail' },
                  ],
                  selectionMode: 'none',
                  pageSize: 20,
                  showSearch: true,
                  density: 'compact',
                  width: 12,
                  height: 6,
                },
              },
            ],
            [{ fromKey: 'audit-buffer', outputPort: 0, toKey: 'audit-table' }],
          ),
        ],
      });
    },
  },
  {
    name: 'instrument_command_to_telemetry_pipeline',
    description: 'Command inject through function transform to MQTT telemetry and debug.',
    parameters: [
      {
        name: 'instrument_id',
        type: 'string',
        description: 'Instrument identifier.',
        default: 'instrument-1',
      },
      {
        name: 'topic',
        type: 'string',
        description: 'Telemetry topic.',
        default: 'lab/instrument/telemetry',
      },
    ],
    instantiate: (base, params) => {
      const tab = tabId(base, 'instrument-telemetry');
      const broker = brokerConfig(base, 'mqtt-broker');
      const instrumentId = stringParam(params, 'instrument_id', 'instrument-1');
      return appendSpec(base, {
        configNodes: [broker],
        tabs: [
          {
            id: tab,
            label: 'Instrument Telemetry',
            nodes: [
              {
                key: 'command',
                type: 'inject',
                label: 'Command',
                position: { x: 100, y: 100 },
                groupKey: 'pipeline',
              },
              {
                key: 'shape-telemetry',
                type: 'function',
                label: 'Shape Telemetry',
                position: { x: 320, y: 100 },
                groupKey: 'pipeline',
                passthrough: {
                  func: `msg.payload = { instrument: ${JSON.stringify(instrumentId)}, value: msg.payload };\nreturn msg;`,
                  outputs: 1,
                },
              },
              {
                key: 'telemetry-out',
                type: 'mqtt out',
                label: 'Telemetry Out',
                position: { x: 560, y: 100 },
                groupKey: 'pipeline',
                passthrough: {
                  topic: stringParam(params, 'topic', 'lab/instrument/telemetry'),
                  qos: '0',
                  broker: compiledConfigId(broker.key),
                },
              },
              {
                key: 'debug',
                type: 'debug',
                label: 'Telemetry Debug',
                position: { x: 560, y: 240 },
              },
            ],
            connections: [
              { fromKey: 'command', outputPort: 0, toKey: 'shape-telemetry' },
              { fromKey: 'shape-telemetry', outputPort: 0, toKey: 'telemetry-out' },
              { fromKey: 'shape-telemetry', outputPort: 0, toKey: 'debug' },
            ],
            groups: [
              {
                key: 'pipeline',
                name: 'Command Pipeline',
                nodeKeys: ['command', 'shape-telemetry', 'telemetry-out'],
              },
            ],
            comments: [{ key: 'note', text: 'Command to telemetry', position: { x: 100, y: 20 } }],
          },
        ],
      });
    },
  },
  {
    name: 'parametrized_fleet_tab',
    description: 'Fleet tab with a configurable number of inject/debug lanes.',
    parameters: [
      { name: 'fleet_name', type: 'string', description: 'Fleet label.', default: 'Fleet' },
      { name: 'device_count', type: 'number', description: 'Number of device lanes.', default: 3 },
    ],
    instantiate: (base, params) => {
      const tab = tabId(base, 'fleet');
      const fleetName = stringParam(params, 'fleet_name', 'Fleet');
      const count = Math.max(1, Math.min(6, Math.trunc(numberParam(params, 'device_count', 3))));
      const nodes: NodeSpec[] = [];
      const connections: ConnectionSpec[] = [];
      for (let i = 0; i < count; i++) {
        const y = 100 + i * 120;
        const injectKey = `device-${i + 1}-inject`;
        const debugKey = `device-${i + 1}-debug`;
        nodes.push(
          { key: injectKey, type: 'inject', label: `Device ${i + 1}`, position: { x: 100, y } },
          { key: debugKey, type: 'debug', label: `Device ${i + 1} Out`, position: { x: 320, y } },
        );
        connections.push({ fromKey: injectKey, outputPort: 0, toKey: debugKey });
      }
      return appendSpec(base, {
        tabs: [simpleTab(tab, fleetName, nodes, connections)],
      });
    },
  },
];
