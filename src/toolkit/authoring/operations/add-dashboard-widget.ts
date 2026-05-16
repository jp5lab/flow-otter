import { generateNodeId } from '../../../shared/ids.js';
import { snapToGrid } from '../../layout/grid.js';
import type { AuthoringSpec, ConfigNodeSpec, NodeSpec, TabSpec, WidgetAnchor } from '../types.js';

/**
 * Mirror of the compiler's deterministic config-node ID derivation.
 * Used by `addDashboardWidget` for `ui-group-dialog` (a config-node variant
 * that cannot use `widgetAnchor`) to compute the `page` ref the same way
 * the compiler will when it emits the existing `ui-page`.
 */
function compiledConfigId(key: string): string {
  return generateNodeId(`config:${key}`);
}

export interface AddDashboardWidgetOpts {
  key?: string;
  label?: string;
  position?: { x: number; y: number };
  groupKey?: string;
  pageKey?: string;
  uiKey?: string;
  passthrough?: Record<string, unknown>;
}

export interface AddDashboardWidgetResult {
  spec: AuthoringSpec;
  newWidgetKey: string;
  /** True when the operation appended a config-node (e.g. dialog-mode ui-group). */
  appendedConfigNode: boolean;
}

class AddDashboardWidgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddDashboardWidgetError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function deriveWidgetKey(widgetType: string, label: string | undefined): string {
  const fromLabel = label
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (fromLabel && fromLabel.length > 0) return `${widgetType}-${fromLabel}`;
  return widgetType;
}

/**
 * Add a Dashboard 2.0 widget to a tab (or, for `ui-group-dialog`, append a
 * dialog-mode ui-group config node).
 *
 * `widgetType` controls how the anchor resolves:
 * - `ui-event`: no anchor — emits client-side events, lives on the tab as a
 *   floating node.
 * - `ui-link`: anchors to `uiKey` (a `ui-base` config node).
 * - `ui-group-dialog`: appended to `configNodes` as a `ui-group` with
 *   `groupType: 'dialog'`. The `pageKey` ref is required.
 * - All other widgets: anchor to `groupKey`.
 *
 * Caller resolves the anchor key (e.g. via `ensureSkeleton` or by reading the
 * existing spec). This operation does NOT auto-create skeleton nodes.
 */
export function addDashboardWidget(
  spec: AuthoringSpec,
  tabId: string | undefined,
  widgetType: string,
  opts: AddDashboardWidgetOpts = {},
): AddDashboardWidgetResult {
  // Dialog-mode ui-group is a config-node variant, not a tab-level widget.
  if (widgetType === 'ui-group-dialog') {
    if (!opts.pageKey) {
      throw new AddDashboardWidgetError(
        `ui-group-dialog requires pageKey (the ui-page config node it belongs to).`,
      );
    }
    const taken = new Set((spec.configNodes ?? []).map((n) => n.key));
    const key = uniqueKey(opts.key ?? 'ui-group-dialog', taken);
    const dialogConfigNode: ConfigNodeSpec = {
      key,
      type: 'ui-group',
      ...(opts.label !== undefined ? { label: opts.label } : {}),
      passthrough: {
        page: compiledConfigId(opts.pageKey),
        groupType: 'dialog',
        ...(opts.passthrough ?? {}),
      },
    };
    return {
      spec: {
        ...spec,
        configNodes: [...(spec.configNodes ?? []), dialogConfigNode],
      },
      newWidgetKey: key,
      appendedConfigNode: true,
    };
  }

  // All other widgets live on a tab.
  if (!tabId) {
    throw new AddDashboardWidgetError(`Widget '${widgetType}' requires tab_id.`);
  }
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddDashboardWidgetError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const takenKeys = new Set(tab.nodes.map((n) => n.key));
  const baseKey = opts.key ?? deriveWidgetKey(widgetType, opts.label);
  const newKey = uniqueKey(baseKey, takenKeys);

  let position: { x: number; y: number };
  if (opts.position) {
    position = snapToGrid(opts.position);
  } else {
    const usedY = new Set(tab.nodes.map((n) => n.position.y));
    let y = 100;
    while (usedY.has(y)) y += 80;
    position = snapToGrid({ x: 160, y });
  }

  // Resolve anchor.
  let widgetAnchor: WidgetAnchor | undefined;
  if (widgetType === 'ui-event') {
    // No anchor — ui-event has no anchor field at all.
    widgetAnchor = undefined;
  } else if (widgetType === 'ui-link') {
    if (!opts.uiKey) {
      throw new AddDashboardWidgetError(
        `ui-link requires uiKey (the ui-base config node it anchors to).`,
      );
    }
    widgetAnchor = { kind: 'ui', refKey: opts.uiKey };
  } else {
    if (!opts.groupKey) {
      throw new AddDashboardWidgetError(
        `Widget '${widgetType}' requires groupKey. Call instantiate_template dashboard_2_skeleton first, or pass a group_key referencing an existing ui-group.`,
      );
    }
    widgetAnchor = { kind: 'group', refKey: opts.groupKey };
  }

  const newNode: NodeSpec = {
    key: newKey,
    type: widgetType,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    position,
    ...(widgetAnchor !== undefined ? { widgetAnchor } : {}),
    ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
  };

  const updatedTab: TabSpec = {
    ...tab,
    nodes: [...tab.nodes, newNode],
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));

  return {
    spec: { ...spec, tabs: updatedTabs },
    newWidgetKey: newKey,
    appendedConfigNode: false,
  };
}
