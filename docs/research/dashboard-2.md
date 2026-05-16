# Dashboard 2.0 Reference for FlowOtter

Research compiled 2026-05-08 against `@flowfuse/node-red-dashboard@1.30.2` (latest stable).

FlowOtter is an MCP server that authors Node-RED `flows.json` through a typed `AuthoringSpec` layer. This document is the source of truth for what Dashboard 2.0 nodes FlowOtter must understand, what fields each one needs, and which patterns belong as `BUILTIN_TEMPLATES` in `src/toolkit/templates/builtin.ts`.

## 1. Overview and Version Timeline

### What it is

`@flowfuse/node-red-dashboard` is a complete from-scratch rewrite of the original `node-red-dashboard` (which is built on Angular v1 and is now in maintenance only). The 2.0 stack is Vue 3 + Vuetify 3 + Apache eCharts on the client, with a Socket.io transport between the Node-RED runtime and the browser. FlowFuse owns the project; the upstream Node-RED organization endorses it as the recommended dashboard going forward (the original `node-red-dashboard` is still installable but is treated as the legacy path, not deprecated yet but no longer receiving feature work).

### Install

```bash
# Inside the Node-RED user directory
npm install @flowfuse/node-red-dashboard
# Or via Palette Manager: search for "node-red-dashboard" and install
# the @flowfuse/-prefixed package, NOT the bare "node-red-dashboard".
```

### Engine requirements (1.30.2)

- `engines.node`: `>=14`
- `node-red.version`: `>=3.0.0` (so Node-RED 3.x and 4.x both work; no breaking-change differences from the dashboard side observed across NR3 vs NR4)

### Stable version timeline

Dates are npm publish dates, pulled from the registry. Pre-1.0 versions are listed for context only; everything FlowOtter cares about is 1.0+.

| Version        | Date            | Headline                                                                                                                                   |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.7.0          | 2023-10-25      | First public release                                                                                                                       |
| 0.11.6         | 2024-01-19      | Final 0.x; many of the core widgets were already present                                                                                   |
| **1.0.0**      | **2024-01-25**  | First stable release; node set largely matches what ships today                                                                            |
| 1.1.0          | 2024-02-08      |                                                                                                                                            |
| 1.5.0          | 2024-03-21      | `ui-radio-group`, `ui-button-group` widgets matured                                                                                        |
| 1.10.0         | 2024-05-22      |                                                                                                                                            |
| 1.15.0         | 2024-08-22      |                                                                                                                                            |
| 1.20.0         | 2024-12-04      |                                                                                                                                            |
| 1.21.0         | 2024-12-20      |                                                                                                                                            |
| 1.22.0         | 2025-01-10      |                                                                                                                                            |
| 1.23.0         | 2025-04-09      |                                                                                                                                            |
| 1.24.0         | 2025-05-12      |                                                                                                                                            |
| 1.25.0         | 2025-07-03      | New `ui-progress` (progress-bar) widget; rebranded "FlowFuse Dashboard"; i18n                                                              |
| 1.26.0         | 2025-07-25      | Sizer/subflow improvements; last ChartJS-based release                                                                                     |
| **1.27.0**     | **2025-09-10**  | **Breaking**: `ui-chart` migrated from ChartJS to Apache eCharts; timestamp-token syntax changed; existing chart configs may need touch-up |
| 1.27.1, 1.27.2 | 2025-09-15 / 19 | Chart-migration follow-ups                                                                                                                 |
| 1.28.0         | 2025-09-24      | Service-worker conditional loading (PWA), tooltip controls                                                                                 |
| 1.29.0         | 2025-10-06      | New "Area" chart type, TTS in `ui-audio`, Y-axis scaling                                                                                   |
| **1.30.0**     | **2025-12-14**  | Many chart fixes; gauge/text static-value display fix; `ui_update`-driven eCharts options                                                  |
| 1.30.1         | 2025-12-30      | Compact-theme padding; chart historical-data fix                                                                                           |
| **1.30.2**     | **2026-01-21**  | Latest. Bugfixes: ui-table typo, audio class field, "send after delay" for number-input, button date payload type.                         |

The single breaking change FlowOtter needs to be aware of since 1.0 is **1.27.0 (eCharts migration)**. Custom timestamp formatters in `ui-chart` configs that worked on 1.26.x may need adjustment on 1.27+.

## 2. Hierarchy: `ui-base` -> `ui-page` -> `ui-group` -> Widgets

Dashboard 2.0 uses Node-RED **config nodes** for the structural layer (base, page, group, theme) and ordinary **flow nodes** for the leaf widgets. This means structural nodes live at the top of `flows.json` (no `z` field, type prefix `ui-`) while widgets live on tabs (with a `z` pointing to a tab and a config-node reference like `group`).

### Wiring rules (enforced by the runtime; FlowOtter must encode these as validation rules)

1. **One `ui-base` per Node-RED instance** is the typical pattern. Multiple are technically allowed but only one is "active" per `path`. The `path` field defines the URL prefix, default `/dashboard`.
2. **Every `ui-page` references a `ui-base`** via its `ui` config field, and gets its own URL segment: `<base.path>/<page.path>`. Example: `ui-base.path = "/dashboard"`, `ui-page.path = "/home"` -> `https://host:1880/dashboard/home`.
3. **Every `ui-page` may reference a `ui-theme`** via its `theme` field. If unset the dashboard falls back to the default theme. Multiple pages can share a theme, or each page can have its own.
4. **Every `ui-group` references a `ui-page`** via its `page` field (config-node ref). Groups are required, even for a single widget — widgets cannot live directly under a page.
5. **Every widget references a `ui-group`** via its `group` field — except the four exceptions:
   - `ui-template` with `templateScope = "widget:page"` references a `page` instead.
   - `ui-template` with `templateScope = "widget:ui"` references a `ui` (base) instead.
   - `ui-template` with `templateScope = "site:style"` or `"page:style"` is a CSS-only template and references either ui or page.
   - `ui-control` and `ui-event` are flow nodes that don't render — they don't need a group.
6. **Group width must fit on its page.** Groups have a `width` (1-N columns) and the page's column count is set by its `breakpoints` config. A 12-column page can host two 6-wide groups side by side. Widgets inside a group must also fit (`widget.width <= group.width`).
7. **`ui-link`** is a sidebar shortcut — it points at a URL or named page from the navigation drawer. It's a config node that references a `ui-base`, not a widget.

### Required-field cheat sheet for the structural nodes

| Type       | Required fields                 | Notable optional fields                                                                                                                                                               |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui-base`  | `name`, `path`                  | `acceptsClientConfig` (string array), `showPathInSidebar`, `navigationStyle` ("default" / "drawer" / "tabs" / "icon-tabs")                                                            |
| `ui-page`  | `name`, `path`, `ui` (base ref) | `theme` (theme ref), `layout` ("grid" / "flex" / "notebook" / "fixed"), `breakpoints` (responsive column counts at viewport widths)                                                   |
| `ui-group` | `name`, `page` (page ref)       | `width` (default 6), `height` (default 1), `order`, `showTitle` (default true), `className`, `visible` (default true), `disabled` (default false), `groupType` ("default" / "dialog") |
| `ui-theme` | `name`                          | `colors` (`surface`, `primary`, `bgPage`, `groupBg`, `groupOutline`), `sizes` (`density`, `pagePadding`, `groupGap`, `groupBorderRadius`, `widgetGap`)                                |
| `ui-link`  | `name`, `path`, `ui` (base ref) | `icon`, `target` ("\_blank" etc.)                                                                                                                                                     |

### Theme model

`ui-theme` is a flat color + sizing configuration (no light/dark switch built into a single theme — instead, you create one theme node per palette). Defaults from the source (`nodes/config/ui_theme.html`):

```js
colors = {
  surface: '#ffffff', // header / surface bg
  primary: '#0094CE', // primary accent
  bgPage: '#eeeeee', // page background
  groupBg: '#ffffff', // group card background
  groupOutline: '#cccccc', // group card border
};
sizes = {
  density: 'default', // 'compact' | 'default' | 'comfortable'
  pagePadding: '12px',
  groupGap: '12px',
  groupBorderRadius: '4px',
  widgetGap: '12px',
};
```

For light/dark mode, the lab pattern is two `ui-theme` nodes (one light, one dark) and a runtime switch via `ui-control`. Custom CSS goes through a `ui-template` with `templateScope = "site:style"` or `"page:style"`.

## 3. Widget Catalogue (1.30.2)

The complete `node-red.nodes` listing from `package.json`:

```
ui-base, ui-form, ui-link, ui-page, ui-text, ui-audio, ui-chart, ui-event,
ui-gauge, ui-group, ui-table, ui-theme, ui-button, ui-slider, ui-spacer,
ui-switch, ui-control, ui-dropdown, ui-markdown, ui-progress, ui-template,
ui-file-input, ui-text-input, ui-radio-group, ui-button-group,
ui-notification, ui-number-input
```

That's **27 registered types** total: 5 structural / config (`ui-base`, `ui-page`, `ui-group`, `ui-theme`, `ui-link`), 2 invisible-flow (`ui-control`, `ui-event`), 20 visible widgets.

### Reference table

All "Required" entries are derived from the `defaults` object's `required: true` markers in each node's HTML registration. "Since" reflects the version where the node first appeared as a stable widget (everything in 1.0.0 unless noted). "Status" is "stable" unless explicitly experimental.

| Type              | Category        | Required fields                                        | Common optional fields                                                                                                                                                                         | Since      | Status | Notes                                                                                                                                                                                                                                              |
| ----------------- | --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui-base`         | Structural      | `name`, `path`                                         | `navigationStyle`, `showPathInSidebar`                                                                                                                                                         | 1.0.0      | stable | Root URL container.                                                                                                                                                                                                                                |
| `ui-page`         | Structural      | `name`, `path`, `ui`                                   | `theme`, `layout`, `breakpoints`                                                                                                                                                               | 1.0.0      | stable | URL path is appended to `ui-base.path`.                                                                                                                                                                                                            |
| `ui-group`        | Structural      | `name`, `page`                                         | `width`, `height`, `order`, `showTitle`, `className`, `visible`, `disabled`, `groupType`                                                                                                       | 1.0.0      | stable | `groupType: "dialog"` makes the group render as a modal.                                                                                                                                                                                           |
| `ui-theme`        | Structural      | `name`                                                 | `colors{}`, `sizes{}`                                                                                                                                                                          | 1.0.0      | stable | Attached to pages, not to groups.                                                                                                                                                                                                                  |
| `ui-link`         | Structural      | `name`, `path`, `ui`                                   | `icon`, `target`                                                                                                                                                                               | 1.0.0      | stable | Sidebar nav shortcut.                                                                                                                                                                                                                              |
| `ui-button`       | General         | `group`, `name`                                        | `label`, `icon`, `iconPosition`, `color`, `textColor`, `iconColor`, `enableClick`, `enablePointerdown`, `enablePointerup`, `clickPayload`, `clickPayloadType`, `width`, `height`               | 1.0.0      | stable | `msg.enabled`, `msg.ui_update` for runtime mutation.                                                                                                                                                                                               |
| `ui-button-group` | Form & Controls | `group`, `name`                                        | `options[]`, `useThemeColors`, `passThru`, `rounded`, `outlined`, `width`, `height`, `label`                                                                                                   | 1.0.0      | stable | Multi-button single-value selector.                                                                                                                                                                                                                |
| `ui-dropdown`     | Form & Controls | `group`, `name`                                        | `label`, `tooltip`, `options[]` (label/value pairs), `multiple`, `passThru`, `clearable`, `topic`, `topicType`                                                                                 | 1.0.0      | stable |                                                                                                                                                                                                                                                    |
| `ui-radio-group`  | Form & Controls | `group`, `name`                                        | `label`, `options[]`, `columns`, `passThru`                                                                                                                                                    | 1.0.0      | stable | Renders as native radio set; horizontal or stacked.                                                                                                                                                                                                |
| `ui-slider`       | Form & Controls | `group`, `name`                                        | `label`, `min`, `max`, `step`, `thumbLabel`, `tickLabels`, `passThru`, `topic`, `topicType`                                                                                                    | 1.0.0      | stable |                                                                                                                                                                                                                                                    |
| `ui-switch`       | Form & Controls | `group`, `name`                                        | `label`, `onIcon`, `offIcon`, `onColor`, `offColor`, `passThru`, `topic`, `topicType`                                                                                                          | 1.0.0      | stable | Boolean only.                                                                                                                                                                                                                                      |
| `ui-text-input`   | Form & Controls | `group`, `name`                                        | `label`, `tooltip`, `mode` ("text"/"password"/"email"/"number"/"color"/"date"/"time"/"week"/"month"/"tel"/"url"), `delay`, `passThru`, `clearable`, `sendOnDelay`, `sendOnBlur`, `sendOnEnter` | 1.0.0      | stable |                                                                                                                                                                                                                                                    |
| `ui-number-input` | Form & Controls | `group`, `name`                                        | `label`, `min`, `max`, `step`, `precision`, `passThru`, `clearable`, `sendOnDelay` (since 1.30.2)                                                                                              | 1.0.0      | stable | "Send after delay" added 1.30.2.                                                                                                                                                                                                                   |
| `ui-form`         | Form & Controls | `group`, `name`, `options[]`                           | `splitLayout`, `submit`, `cancel`, `resetOnSubmit`, `formValue`                                                                                                                                | 1.0.0      | stable | `options[]` describes a list of `{type, label, key, required, rows?}` field specs.                                                                                                                                                                 |
| `ui-file-input`   | Form & Controls | `group`, `name`                                        | `label`, `accept`, `multiple`, `chunkSize`                                                                                                                                                     | 1.0.0      | stable | Streams uploaded file to flow as `msg.payload` (base64 or Buffer).                                                                                                                                                                                 |
| `ui-text`         | General         | `group`, `name`                                        | `label`, `format` (Mustache), `layout` ("row-left"/"row-center"/"row-right"/"row-spread"/"col-center"), `style`, `font`, `fontSize`, `color`                                                   | 1.0.0      | stable | `format` is a `{{msg.payload}}` Mustache string.                                                                                                                                                                                                   |
| `ui-markdown`     | General         | `group`, `name`                                        | `content` (markdown body), `style`, `lineSpacing`                                                                                                                                              | 1.0.0      | stable | Renders Markdown + Mermaid charts.                                                                                                                                                                                                                 |
| `ui-table`        | Data Vis        | `group`, `name`                                        | `columns[]`, `selectionMode` ("none"/"single"/"multiple"), `pageSize`, `showSearch`, `density`                                                                                                 | 1.0.0      | stable | Class field added 1.27.0. Typo fix in 1.30.2.                                                                                                                                                                                                      |
| `ui-chart`        | Data Vis        | `group`, `name`, `chartType`, `xAxisType`              | `label`, `action` ("append"/"replace"), `xAxisFormat`, `xAxisLimit`, `pointShape`, `pointRadius`, `series`, `xProperty`, `yProperty`, `textColor`, `gridColor`, `showLegend`                   | 1.0.0      | stable | **eCharts since 1.27.0** (was ChartJS). Chart types: line (linear/step/bezier/cubic/cubic-mono), bar (grouped/stacked), pie, doughnut, scatter, histogram, **area (since 1.29.0)**. Runtime override: `msg.ui_update.chartOptions` (since 1.30.0). |
| `ui-gauge`        | Data Vis        | `group`, `name`                                        | `gtype` ("gauge"/"battery"/"tile"/"half-gauge"/"three-quarter"), `min`, `max`, `units`, `iconClass`, `colorScheme`, `prefix`, `suffix`, `valueFormat`, `sizeLabel`, `sizeValue`                | 1.0.0      | stable | Static-value display fix in 1.30.0.                                                                                                                                                                                                                |
| `ui-progress`     | Data Vis        | `group`, `name`                                        | `min`, `max`, `colorMode`, `colorPrimary`, `style` (linear/circular), `striped`, `valueFormat`, `prefix`, `suffix`                                                                             | **1.25.0** | stable | New widget added in 1.25.0.                                                                                                                                                                                                                        |
| `ui-audio`        | General         | `group`, `name`                                        | `urlSource`, `payloadType`, `volume`, `class`                                                                                                                                                  | 1.0.0      | stable | TTS support added in 1.29.0. Class field added in 1.30.2.                                                                                                                                                                                          |
| `ui-notification` | General         | `group`, `name`                                        | `position` ("top right"/"top center"/"top left"/"bottom right"/"bottom center"/"bottom left"), `color`, `displayTime`, `allowDismiss`, `showCountdown`, `raw`, `topic`                         | 1.0.0      | stable | Toast-style transient banner.                                                                                                                                                                                                                      |
| `ui-spacer`       | Layout          | `group`, `name`                                        | `width`, `height`, `order`, `className`                                                                                                                                                        | 1.0.0      | stable | Invisible filler to shape grid layout.                                                                                                                                                                                                             |
| `ui-template`     | General + Style | `group` OR `page` OR `ui` (depends on `templateScope`) | `templateScope` ("local"/"widget:page"/"widget:ui"/"site:style"/"page:style"), `format` (the HTML/Vue/CSS body), `className`                                                                   | 1.0.0      | stable | Vue 3 Options API + Vuetify 3 in widget scopes; access to `msg`, `send()`, `this.$socket`, `id`. CSS scopes don't render UI.                                                                                                                       |
| `ui-control`      | Invisible       | (none required)                                        | (configured via incoming msg)                                                                                                                                                                  | 1.0.0      | stable | Receives `msg.payload` to: navigate pages, show/hide pages/groups/widgets, refresh, focus widget, set tab. Multiple payload shapes (see below).                                                                                                    |
| `ui-event`        | Invisible       | (none required)                                        | (no config)                                                                                                                                                                                    | 1.0.0      | stable | Emits `msg` whenever a dashboard event fires (page change, widget interaction, client connect/disconnect).                                                                                                                                         |

**Status flags in 1.30.2:** No node currently ships with an "experimental" or "alpha" tag; all 27 are in the stable trunk. The closest thing to "experimental" is the commented-out `widget:script` and `page:script` `templateScope` options visible in `ui_template.html` — they're disabled in the editor and reserved for future use.

### `ui-control` payload shapes (the one nodefamily FlowOtter must encode carefully)

`ui-control` is configuration-by-message. The message determines the operation:

```js
// Navigate to named page
msg.payload = 'Settings';

// Navigate with query params (read via this.$route.query in ui-template)
msg.payload = { page: 'Settings', query: { user: 'alice' } };

// Relative navigation
msg.payload = '+1'; // next
msg.payload = '-1'; // previous
msg.payload = ''; // refresh current

// External URL
msg.payload = { url: 'https://flowfuse.com', target: '_blank' };

// Show/hide pages and groups
msg.payload = {
  pages: { show: ['Home', 'Reports'], hide: ['Admin'] },
  groups: { show: ['Sensor Data'], hide: ['Debug Panel'] },
};

// Group references can be qualified
msg.payload = {
  groups: { show: ['<Page Name>:<Group Name>', { page: '<Page Id>', group: '<Group Name>' }] },
};
```

FlowOtter's lint layer should treat `ui-control` as a node with no `passthrough` validation — its real semantics come from upstream nodes. But it should warn when `ui-control` is wired without an upstream `inject`/`function`/`change` to give it a payload.

## 4. Differences from Dashboard 1.0 (`node-red-dashboard`)

The two projects share almost no internals. They are different installable packages with different node prefixes and config models. Trying to host both at the same URL prefix will fail, though both can coexist on different paths.

| Concern           | Dashboard 1.0 (`node-red-dashboard`)                                                                                                                                       | Dashboard 2.0 (`@flowfuse/node-red-dashboard`)                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm package       | `node-red-dashboard`                                                                                                                                                       | `@flowfuse/node-red-dashboard`                                                                                                                                                                                     |
| Node prefix       | `ui_` (e.g. `ui_button`, `ui_text`)                                                                                                                                        | `ui-` (e.g. `ui-button`, `ui-text`)                                                                                                                                                                                |
| Node IDs (sample) | `ui_button`, `ui_text`, `ui_chart`, `ui_gauge`, `ui_dropdown`, `ui_form`, `ui_slider`, `ui_switch`, `ui_template`, `ui_toast`, `ui_audio`, `ui_link`, `ui_tab`, `ui_group` | `ui-button`, `ui-text`, `ui-chart`, `ui-gauge`, `ui-dropdown`, `ui-form`, `ui-slider`, `ui-switch`, `ui-template`, `ui-notification` (was `ui_toast`), `ui-audio`, `ui-link`, `ui-page` (was `ui_tab`), `ui-group` |
| Hierarchy root    | A single `ui_base` config node with hardcoded children — no per-page theme                                                                                                 | `ui-base` -> `ui-page` -> `ui-group` -> widget, with optional `ui-theme` per page                                                                                                                                  |
| Frontend stack    | AngularJS v1 + Angular Material + ChartJS v2                                                                                                                               | Vue 3 + Vuetify 3 + Apache eCharts (since 1.27.0; ChartJS until 1.26.x)                                                                                                                                            |
| Custom widgets    | `ui_template` with Angular directives                                                                                                                                      | `ui-template` with Vue 3 Options API                                                                                                                                                                               |
| Multi-page        | "Tabs" (`ui_tab` config)                                                                                                                                                   | "Pages" (`ui-page` config), each with its own URL                                                                                                                                                                  |
| URL convention    | `/ui` prefix, `#!/<index>` fragment routing                                                                                                                                | `/dashboard` prefix, real path routing (`/dashboard/<page-name>`)                                                                                                                                                  |
| Theme             | Single global theme                                                                                                                                                        | Per-page `ui-theme` config, plus CSS via `ui-template`                                                                                                                                                             |
| Status (2026-05)  | Maintenance only; recommended migration target is 2.0                                                                                                                      | Active development at FlowFuse; weekly+ patch releases                                                                                                                                                             |

**Important callout for FlowOtter**: A `flows.json` containing both `ui_*` (1.0) and `ui-*` (2.0) node types is technically valid Node-RED — they're separate plugins. But the lint layer should treat that as a strong warning: "mixed Dashboard 1.0 and Dashboard 2.0 nodes detected". FlowOtter authors Dashboard 2.0 exclusively; mixed 1.0/2.0 flows are flagged as warnings, not errors.

There is a community migration tool, **`@flowfuse/node-red-dashboard-2-migration`** (separate npm package), which translates `ui_*` configs to `ui-*` configs. FlowOtter doesn't need to embed that logic — if a user wants to migrate, they install and run it once, then FlowOtter authors fresh 2.0 against the migrated flows.

### Node-RED 3.x vs 4.x

Both supported. The `package.json` peer is `node-red >=3.0.0` and there are no known 3.x-vs-4.x branching code paths in the dashboard plugin. FlowOtter targets Node-RED 3.x and 4.x equally. FlowOtter doesn't need to gate any behavior on the runtime major version.

## 5. Custom Widget Authoring (Brief)

Two paths:

1. **`ui-template`** (in-flow). Set `templateScope` to `local`/`widget:page`/`widget:ui` and write Vue 3 Options API in the `format` field. The component context exposes:
   - `msg` — last received message (reactive)
   - `send(msg)` — send a message back into the flow
   - `this.$socket` — Socket.io client for direct backend round-trips
   - `id` — node id
   - All Vuetify 3 components are pre-imported and globally available (`<v-btn>`, `<v-card>`, etc.)
2. **External plugin package**. Scaffold using FlowFuse's `node-red-dashboard-2-ui-example` template. Each widget ships as a Node-RED node (HTML registration + JS runtime + Vue 3 SFC). The widget gets registered against `ui-base` via the `acceptsClientConfig` mechanism. Out of scope for FlowOtter authoring — but FlowOtter should treat any installed third-party `ui-*` node type as a generic widget (group-required, width/height/order/className optional) and lint it accordingly.

## 6. What FlowOtter Probably Needs to Support

FlowOtter's `src/toolkit/templates/builtin.ts` already has one Dashboard 2.0 entry: `dashboard_status_panel` (a `ui_base` + `ui_page` + `ui_group` + `ui_text` chain — note the existing template uses underscores, **which is wrong for 2.0** — the 2.0 type strings are hyphenated `ui-base`, `ui-page`, `ui-group`, `ui-text`). That template needs a correction pass.

### Recommended changes to existing code

1. **Fix the type-string typo in `dashboard_status_panel`**. The current entry uses `ui_base`, `ui_page`, `ui_group`, `ui_text`. Dashboard 2.0 registers these as `ui-base`, `ui-page`, `ui-group`, `ui-text`. Without the fix, instantiating the template produces a `flows.json` that Dashboard 2.0 ignores (those IDs match Dashboard 1.0 conventions, not 2.0).
2. **Add validate/lint rules** under `src/toolkit/validate/rules/` and `src/toolkit/lint/`:
   - `dashboard-2-hierarchy`: every `ui-page` has a `ui` ref to a `ui-base`; every `ui-group` has a `page` ref to a `ui-page`; every widget has a `group` ref (with the four exceptions for `ui-template`/`ui-control`/`ui-event`).
   - `dashboard-2-required-fields`: per-widget required-field check using the table in section 3.
   - `dashboard-2-group-width-fits`: `widget.width <= group.width`, `sum-of-group-widths-on-row <= page.columns-at-breakpoint`.
   - `dashboard-2-mixed-versions`: warn if `flows.json` contains both `ui_*` (1.0) and `ui-*` (2.0) types.

### Recommended new templates

The existing template scheme (`BUILTIN_TEMPLATES` in `src/toolkit/templates/builtin.ts`) generates a tab plus optional config nodes. Each entry has a `name`, `description`, declared `parameters`, and an `instantiate(base, params)` function returning the merged spec. The patterns below are common Dashboard 2.0 idioms — shipping them as templates removes copy-paste authoring for new projects.

| Template name                               | What it builds                                                                              | Why                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `dashboard_2_skeleton`                      | One `ui-base` + one `ui-page` + one `ui-theme` + one `ui-group`, no widgets                 | The "every project starts here" foundation.                                           |
| `dashboard_2_status_panel` (rename current) | Skeleton + one `ui-text` reading `{{msg.payload}}`                                          | The existing template, fixed for 2.0 type strings.                                    |
| `dashboard_2_telemetry_chart`               | Skeleton + one `ui-chart` (line, timescale x-axis)                                          | Most common visualization in lab dashboards.                                          |
| `dashboard_2_command_panel`                 | Skeleton + `ui-button-group` + `ui-text` + `ui-notification`                                | Operator action surface (start/stop/abort). Common pattern for any control dashboard. |
| `dashboard_2_form_input`                    | Skeleton + `ui-form` with 2-3 typed fields, wired into a `function` and `debug`             | Data-entry use case, e.g., session metadata.                                          |
| `dashboard_2_gauge_grid`                    | Skeleton + 4x `ui-gauge` (V/I/P/E) in a 12-col group                                        | Standard EV-charging dashboard tile bank.                                             |
| `dashboard_2_table_log`                     | Skeleton + `ui-table` listening to `msg.payload` arrays                                     | Event log / trace viewer.                                                             |
| `dashboard_2_dual_theme`                    | Skeleton with two `ui-theme` nodes + `ui-control` + `ui-button`                             | Light/dark toggle pattern.                                                            |
| `dashboard_2_multi_page`                    | One `ui-base`, three `ui-page`s (Overview / Phase-Bringup / Charts) each with its own group | Multi-page operator console.                                                          |
| `dashboard_2_template_widget`               | Skeleton + one `ui-template` with a Vue 3 component scaffold                                | Escape hatch for custom widgets.                                                      |
| `dashboard_2_custom_css`                    | One `ui-template` with `templateScope="site:style"` and a CSS body                          | Site-wide custom styling.                                                             |

These templates compose. A user pipeline of "instantiate `dashboard_2_skeleton`, then `dashboard_2_telemetry_chart`, then `dashboard_2_command_panel`" should produce a working three-section operator dashboard.

### Authoring-spec considerations

The existing `AuthoringSpec` distinguishes config nodes (top-level) from flow nodes (per-tab). Dashboard 2.0 fits this cleanly:

- `ui-base`, `ui-page`, `ui-group`, `ui-theme`, `ui-link` -> `configNodes` array.
- All widgets (`ui-button`, `ui-text`, etc.) -> `nodes` inside a tab.
- Cross-references (widget.group -> ui-group.id) use the `compiledConfigId(key)` helper that's already in `builtin.ts` for the broker pattern.

The one subtlety: **`ui-template` may reference `ui` or `page` instead of `group` depending on `templateScope`**. FlowOtter's NodeSpec needs to support all three reference shapes — encode the widget's "group anchor" as a typed enum `{ kind: 'group' | 'page' | 'ui', refKey: string }` rather than a bare `group: string` field. This avoids special-casing every widget.

A second subtlety: **subflows containing dashboard widgets**. The HTML registration files reveal special CSS classes (`nr-db-ui-element-show-in-subflow`, `nr-db-ui-element-hide-in-subflow`) that toggle widget config visibility when the widget lives inside a subflow definition. FlowOtter's existing subflow-spec handling probably already covers this, but verify: a `ui-button` inside a subflow definition should **not** have a fixed `group` — the group is supplied by the subflow instance's wiring at the workspace level. Subflowed widgets are a future concern, not a 1.0 blocker.

## 7. Sources

Primary references used to compile this document:

- npm registry: `https://registry.npmjs.org/@flowfuse/node-red-dashboard` (version timeline, engine requirements, registered node types).
- FlowFuse Dashboard 2.0 docs: https://dashboard.flowfuse.com/ — getting-started, widgets index, individual widget pages.
- GitHub: https://github.com/FlowFuse/node-red-dashboard — node HTML registrations (`nodes/config/*.html`, `nodes/widgets/*.html`) for required-field extraction.
- GitHub releases: https://github.com/FlowFuse/node-red-dashboard/releases — change summaries for 1.25 through 1.30.2.
- Discourse: https://discourse.nodered.org/c/dashboard/16 — community confirmation of the 1.27 ChartJS->eCharts migration.
- Migration package: https://github.com/FlowFuse/node-red-dashboard-2-migration — referenced for completeness; not used by FlowOtter.

Word count: approximately 3,100 words.
