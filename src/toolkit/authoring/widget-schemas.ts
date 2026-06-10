import { z } from 'zod';

/**
 * Per-widget passthrough schemas for Dashboard 2.0 widget types. Drives the
 * generic `add_dashboard_widget` tool's validation. Anchor fields (`group`,
 * `page`, `ui`) are NOT part of these schemas — they're set by the
 * `widgetAnchor` mechanism on the NodeSpec and resolved by the compiler.
 *
 * Aligned with Dashboard 2.0 ≥ 1.30.2 widget HTML registrations.
 */

const COMMON_LAYOUT = {
  width: z.number().int().min(1).max(24).optional(),
  height: z.number().int().min(1).max(24).optional(),
  order: z.number().int().optional(),
  className: z.string().optional(),
  visible: z.boolean().optional(),
  disabled: z.boolean().optional(),
};

const OptionEntry = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const DropdownPassthrough = z
  .object({
    label: z.string().optional(),
    tooltip: z.string().optional(),
    options: z.array(OptionEntry.passthrough()).optional(),
    multiple: z.boolean().optional(),
    passThru: z.boolean().optional(),
    clearable: z.boolean().optional(),
    topic: z.string().optional(),
    topicType: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const RadioGroupPassthrough = z
  .object({
    label: z.string().optional(),
    options: z.array(OptionEntry.passthrough()).optional(),
    columns: z.number().int().min(1).max(12).optional(),
    passThru: z.boolean().optional(),
    topic: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const SliderPassthrough = z
  .object({
    label: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    thumbLabel: z.boolean().optional(),
    tickLabels: z.boolean().optional(),
    passThru: z.boolean().optional(),
    topic: z.string().optional(),
    topicType: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const SwitchPassthrough = z
  .object({
    label: z.string().optional(),
    onIcon: z.string().optional(),
    offIcon: z.string().optional(),
    onColor: z.string().optional(),
    offColor: z.string().optional(),
    passThru: z.boolean().optional(),
    topic: z.string().optional(),
    topicType: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const TextInputPassthrough = z
  .object({
    label: z.string().optional(),
    tooltip: z.string().optional(),
    mode: z
      .enum([
        'text',
        'password',
        'email',
        'number',
        'color',
        'date',
        'time',
        'week',
        'month',
        'tel',
        'url',
      ])
      .optional(),
    delay: z.number().nonnegative().optional(),
    passThru: z.boolean().optional(),
    clearable: z.boolean().optional(),
    sendOnDelay: z.boolean().optional(),
    sendOnBlur: z.boolean().optional(),
    sendOnEnter: z.boolean().optional(),
    topic: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const NumberInputPassthrough = z
  .object({
    label: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    precision: z.number().int().nonnegative().optional(),
    passThru: z.boolean().optional(),
    clearable: z.boolean().optional(),
    sendOnDelay: z.boolean().optional(),
    topic: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const FileInputPassthrough = z
  .object({
    label: z.string().optional(),
    accept: z.string().optional(),
    multiple: z.boolean().optional(),
    chunkSize: z.number().int().positive().optional(),
    topic: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const MarkdownPassthrough = z
  .object({
    content: z.string().optional(),
    style: z.string().optional(),
    lineSpacing: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const ProgressPassthrough = z
  .object({
    label: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    colorMode: z.enum(['fixed', 'gradient', 'threshold']).optional(),
    colorPrimary: z.string().optional(),
    style: z.enum(['linear', 'circular']).optional(),
    striped: z.boolean().optional(),
    valueFormat: z.string().optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const AudioPassthrough = z
  .object({
    urlSource: z.string().optional(),
    payloadType: z.string().optional(),
    volume: z.number().min(0).max(1).optional(),
    class: z.string().optional(),
    topic: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const SpacerPassthrough = z
  .object({
    ...COMMON_LAYOUT,
  })
  .passthrough();

const EventPassthrough = z
  .object({
    events: z
      .array(
        z.enum([
          'change-page',
          'change-tab',
          'change-group',
          'client-connect',
          'client-disconnect',
        ]),
      )
      .optional(),
  })
  .passthrough();

const LinkPassthrough = z
  .object({
    icon: z.string().optional(),
    target: z.enum(['_self', '_blank']).optional(),
  })
  .passthrough();

const GroupDialogPassthrough = z
  .object({
    name: z.string().min(1),
    groupType: z.literal('dialog'),
    showTitle: z.boolean().optional(),
    width: z.number().int().min(1).max(24).optional(),
    height: z.number().int().min(1).max(24).optional(),
    className: z.string().optional(),
  })
  .passthrough();

// --- Widgets added in v1.3.0 (Item 9 of the v1.3.0 plan in docs/DESIGN.md) ---
//
// Schemas are intentionally permissive (.passthrough): Dashboard 2.0 widget
// config surface is broad and version-evolving; we lock in the
// most-commonly-set fields and let users layer arbitrary additional
// passthrough keys for niche configs.

const ButtonPassthrough = z
  .object({
    label: z.string().optional(),
    icon: z.string().optional(),
    iconPosition: z.enum(['left', 'right']).optional(),
    buttonColor: z.string().optional(),
    textColor: z.string().optional(),
    iconColor: z.string().optional(),
    payload: z.unknown().optional(),
    payloadType: z.string().optional(),
    topic: z.string().optional(),
    topicType: z.string().optional(),
    // ISA-101 hooks (Item 11 validator enforces these on destructive payloads):
    confirm: z.boolean().optional(),
    confirmMessage: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const ButtonGroupOption = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
});

const ButtonGroupPassthrough = z
  .object({
    label: z.string().optional(),
    options: z.array(ButtonGroupOption.passthrough()).optional(),
    passThru: z.boolean().optional(),
    topic: z.string().optional(),
    // Destructive operations on multi-state selectors should require confirm
    // per ISA-101 — surfaced for the soft-nudge rule in Item 5/11.
    confirm: z.boolean().optional(),
    confirmMessage: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const TextPassthrough = z
  .object({
    label: z.string().optional(),
    layout: z.enum(['row-left', 'row-right', 'row-center', 'row-spaced', 'col-center']).optional(),
    color: z.string().optional(),
    fontSize: z.number().positive().optional(),
    icon: z.string().optional(),
    // Display options
    format: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const NotificationPassthrough = z
  .object({
    displayTime: z.number().nonnegative().optional(),
    showCountdown: z.boolean().optional(),
    allowDismiss: z.boolean().optional(),
    color: z.string().optional(),
    position: z
      .enum(['top right', 'top left', 'bottom right', 'bottom left', 'top center', 'bottom center'])
      .optional(),
    rawHTML: z.boolean().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const TemplatePassthrough = z
  .object({
    name: z.string().optional(),
    code: z.string().optional(),
    scope: z.enum(['local', 'global', 'css-page', 'css-all', 'css-base']).optional(),
    classList: z.string().optional(),
    passthru: z.boolean().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const FormFieldType = z.enum([
  'text',
  'multiline',
  'password',
  'email',
  'number',
  'checkbox',
  'switch',
  'date',
  'time',
]);

const FormField = z
  .object({
    label: z.string(),
    key: z.string(),
    type: FormFieldType,
    required: z.boolean().optional(),
    rows: z.number().int().positive().optional(),
    value: z.unknown().optional(),
  })
  .passthrough();

const FormPassthrough = z
  .object({
    label: z.string().optional(),
    options: z.array(FormField).optional(),
    formValue: z.record(z.unknown()).optional(),
    splitLayout: z.boolean().optional(),
    submitLabel: z.string().optional(),
    cancelLabel: z.string().optional(),
    resetOnSubmit: z.boolean().optional(),
    topic: z.string().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const TableColumn = z
  .object({
    key: z.string(),
    label: z.string().optional(),
    type: z
      .enum([
        'text',
        'html',
        'link',
        'color',
        'progress',
        'sparkline',
        'button',
        'image',
        'icon',
        'rating',
        'switch',
      ])
      .optional(),
    sortable: z.boolean().optional(),
    filter: z.boolean().optional(),
    align: z.enum(['left', 'right', 'center']).optional(),
  })
  .passthrough();

const TablePassthrough = z
  .object({
    label: z.string().optional(),
    maxrows: z.number().int().positive(),
    action: z.enum(['append', 'replace']).optional(),
    columns: z.array(TableColumn).optional(),
    rowSelection: z.enum(['none', 'click', 'checkbox']).optional(),
    searchable: z.boolean().optional(),
    showSearch: z.boolean().optional(),
    paginationType: z.enum(['none', 'paginated', 'infinite']).optional(),
    fixedHeader: z.boolean().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const ChartPassthrough = z
  .object({
    label: z.string().optional(),
    chartType: z.enum(['line', 'bar', 'scatter', 'pie', 'doughnut', 'histogram', 'area']),
    xAxisType: z.enum(['time', 'linear', 'category']).optional(),
    xAxisLabel: z.string().optional(),
    xAxisLimit: z.number().int().positive().optional(),
    xAxisLimitType: z.enum(['count', 'time']).optional(),
    yAxisLabel: z.string().optional(),
    yMin: z.number().optional(),
    yMax: z.number().optional(),
    action: z.enum(['append', 'replace']).optional(),
    showLegend: z.boolean().optional(),
    pointShape: z.string().optional(),
    pointRadius: z.number().nonnegative().optional(),
    animationDuration: z.number().nonnegative().optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const GaugeSegment = z.object({
  from: z.number(),
  color: z.string(),
});

const GaugePassthrough = z
  .object({
    label: z.string().optional(),
    units: z.string().optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    icon: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    style: z.enum(['needle', 'rounded', 'half', 'three-quarter', 'tile', 'battery', 'tank']),
    sizeThickness: z.number().int().positive().optional(),
    sizeGap: z.number().int().nonnegative().optional(),
    segments: z.array(GaugeSegment).optional(),
    ...COMMON_LAYOUT,
  })
  .passthrough();

const ControlAction = z.enum([
  'navigate',
  'show',
  'hide',
  'enable',
  'disable',
  'open',
  'close',
  'reload',
]);

const ControlPassthrough = z
  .object({
    events: z
      .array(
        z
          .object({
            type: ControlAction,
            target: z.string().optional(),
            payload: z.unknown().optional(),
          })
          .passthrough(),
      )
      .optional(),
    // Backwards compat with single-event shape used by older flows
    action: ControlAction.optional(),
    target: z.string().optional(),
  })
  .passthrough();

export const WIDGET_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = Object.freeze({
  'ui-dropdown': DropdownPassthrough,
  'ui-radio-group': RadioGroupPassthrough,
  'ui-slider': SliderPassthrough,
  'ui-switch': SwitchPassthrough,
  'ui-text-input': TextInputPassthrough,
  'ui-number-input': NumberInputPassthrough,
  'ui-file-input': FileInputPassthrough,
  'ui-markdown': MarkdownPassthrough,
  'ui-progress': ProgressPassthrough,
  'ui-audio': AudioPassthrough,
  'ui-spacer': SpacerPassthrough,
  'ui-event': EventPassthrough,
  'ui-link': LinkPassthrough,
  'ui-group-dialog': GroupDialogPassthrough,
  // Added v1.3.0:
  'ui-button': ButtonPassthrough,
  'ui-button-group': ButtonGroupPassthrough,
  'ui-text': TextPassthrough,
  'ui-notification': NotificationPassthrough,
  'ui-template': TemplatePassthrough,
  'ui-form': FormPassthrough,
  'ui-table': TablePassthrough,
  'ui-chart': ChartPassthrough,
  'ui-gauge': GaugePassthrough,
  'ui-control': ControlPassthrough,
});

/**
 * Anchor requirement per widget type.
 * - `group`: widget needs widgetAnchor.kind='group' (default for most)
 * - `ui`: anchors to a ui-base config node (only ui-link)
 * - `none`: no anchor needed (ui-event has none)
 * - `config`: not a widget; it's a config-node variant (ui-group-dialog)
 */
export type WidgetAnchorRequirement = 'group' | 'ui' | 'none' | 'config';

export const WIDGET_ANCHOR_REQUIREMENT: Readonly<Record<string, WidgetAnchorRequirement>> =
  Object.freeze({
    'ui-dropdown': 'group',
    'ui-radio-group': 'group',
    'ui-slider': 'group',
    'ui-switch': 'group',
    'ui-text-input': 'group',
    'ui-number-input': 'group',
    'ui-file-input': 'group',
    'ui-markdown': 'group',
    'ui-progress': 'group',
    'ui-audio': 'group',
    'ui-spacer': 'group',
    'ui-event': 'none',
    'ui-link': 'ui',
    'ui-group-dialog': 'config',
    // Added v1.3.0:
    'ui-button': 'group',
    'ui-button-group': 'group',
    'ui-text': 'group',
    'ui-notification': 'ui',
    'ui-template': 'group',
    'ui-form': 'group',
    'ui-table': 'group',
    'ui-chart': 'group',
    'ui-gauge': 'group',
    'ui-control': 'ui',
  });

export function getWidgetSchema(widgetType: string): z.ZodTypeAny | undefined {
  return WIDGET_SCHEMAS[widgetType];
}

export function getWidgetAnchorRequirement(
  widgetType: string,
): WidgetAnchorRequirement | undefined {
  return WIDGET_ANCHOR_REQUIREMENT[widgetType];
}

export function knownWidgetTypes(): readonly string[] {
  return Object.freeze(Object.keys(WIDGET_SCHEMAS));
}
