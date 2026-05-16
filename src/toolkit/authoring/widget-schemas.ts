import { z } from 'zod';

/**
 * Per-widget passthrough schemas for Dashboard 2.0 widget types. Drives the
 * generic `add_dashboard_widget` tool's validation. Anchor fields (`group`,
 * `page`, `ui`) are NOT part of these schemas — they're set by the
 * `widgetAnchor` mechanism on the NodeSpec and resolved by the compiler.
 *
 * Sourced from FlowFuse Dashboard 2.0 ≥ 1.30.2 widget HTML registrations.
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
