import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { Container } from '../../../../../src/server/container.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { addDashboardWidgetTool } from '../../../../../src/server/tools/author/add-dashboard-widget.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import { decompile } from '../../../../../src/toolkit/authoring/decompile.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';
import { instantiateTemplate } from '../../../../../src/toolkit/templates/index.js';

let root: string;
let container: Container;
let ctx: ToolContext;
const TAB_ID = 'tab-1';

const SEED_FLOWS = JSON.stringify([
  { id: TAB_ID, type: 'tab', label: 'Test', disabled: false, info: '' },
]);

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'add-widget-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, SEED_FLOWS, 'utf8');
  const config = loadConfig({
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
    REQUEST_TIMEOUT_MS: '100',
    ENABLE_WRITE_TOOLS: 'true',
    READ_ONLY_MODE: 'false',
  });
  const logger = createLogger({ level: 'silent' });
  container = {
    config,
    flowSource: new FileFlowSource({ path: flowsPath }),
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging: new StagedStore({ dir: config.STAGING_DIR }),
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: () => new Date('2026-05-10T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
  };
  ctx = { ...container, enrichAudit: () => undefined, container };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seedSkeleton(): Promise<{ groupKey: string; pageKey: string; uiKey: string }> {
  // Apply the dashboard_2_skeleton template directly and persist to disk so
  // the live flow source returns it on the next load.
  const { flows: prior } = await ctx.flowSource.load();
  const priorSpec = decompile(prior);
  const withSkeleton = instantiateTemplate(priorSpec, 'dashboard_2_skeleton');
  const compiled = compile(withSkeleton, { prior });
  await ctx.flowSource.save(compiled.flows, { reason: 'seed-skeleton' });
  return { groupKey: 'ui-group', pageKey: 'ui-page', uiKey: 'ui-base' };
}

describe('add_dashboard_widget — group-anchored widgets', () => {
  it('adds a ui-slider with validated passthrough', async () => {
    const { groupKey } = await seedSkeleton();

    const result = (await addDashboardWidgetTool.handler(
      {
        tab_id: TAB_ID,
        widget_type: 'ui-slider',
        opts: {
          label: 'Setpoint',
          group_key: groupKey,
          passthrough: { label: 'Setpoint', min: 0, max: 100, step: 1 },
        },
      },
      ctx,
    )) as { ok: boolean; widget_type: string; widget_id?: string };

    expect(result.ok).toBe(true);
    expect(result.widget_type).toBe('ui-slider');
    expect(result.widget_id).toBeDefined();
  });

  it('rejects ui-slider with malformed passthrough (step must be positive)', async () => {
    const { groupKey } = await seedSkeleton();
    await expect(
      addDashboardWidgetTool.handler(
        {
          tab_id: TAB_ID,
          widget_type: 'ui-slider',
          opts: {
            group_key: groupKey,
            passthrough: { step: -1 }, // step must be positive
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/passthrough for widget 'ui-slider' failed schema validation/);
  });

  it('rejects ui-slider without group_key', async () => {
    await seedSkeleton();
    await expect(
      addDashboardWidgetTool.handler({ tab_id: TAB_ID, widget_type: 'ui-slider', opts: {} }, ctx),
    ).rejects.toThrow(/requires opts\.group_key/);
  });

  it('adds a ui-dropdown with options array', async () => {
    const { groupKey } = await seedSkeleton();
    const result = (await addDashboardWidgetTool.handler(
      {
        tab_id: TAB_ID,
        widget_type: 'ui-dropdown',
        opts: {
          label: 'Mode',
          group_key: groupKey,
          passthrough: {
            label: 'Mode',
            options: [
              { label: 'Auto', value: 'auto' },
              { label: 'Manual', value: 'manual' },
            ],
          },
        },
      },
      ctx,
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it('adds a ui-markdown widget', async () => {
    const { groupKey } = await seedSkeleton();
    const result = (await addDashboardWidgetTool.handler(
      {
        tab_id: TAB_ID,
        widget_type: 'ui-markdown',
        opts: {
          label: 'Welcome',
          group_key: groupKey,
          passthrough: { content: '## Welcome\nThis is a dashboard.' },
        },
      },
      ctx,
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });
});

describe('add_dashboard_widget — special-anchor widgets', () => {
  it('adds a ui-link anchored to ui_key', async () => {
    const { uiKey } = await seedSkeleton();
    const result = (await addDashboardWidgetTool.handler(
      {
        tab_id: TAB_ID,
        widget_type: 'ui-link',
        opts: {
          label: 'External',
          ui_key: uiKey,
          passthrough: { path: '/external', icon: 'mdi-link', target: '_blank' },
        },
      },
      ctx,
    )) as { ok: boolean; widget_type: string };
    expect(result.ok).toBe(true);
    expect(result.widget_type).toBe('ui-link');
  });

  it('rejects ui-link without ui_key', async () => {
    await seedSkeleton();
    await expect(
      addDashboardWidgetTool.handler({ tab_id: TAB_ID, widget_type: 'ui-link', opts: {} }, ctx),
    ).rejects.toThrow(/requires opts\.ui_key/);
  });

  it('adds a ui-event without anchor', async () => {
    await seedSkeleton();
    const result = (await addDashboardWidgetTool.handler(
      {
        tab_id: TAB_ID,
        widget_type: 'ui-event',
        opts: { passthrough: { events: ['change-page'] } },
      },
      ctx,
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it('adds a ui-group-dialog as config-node anchored to page_key', async () => {
    const { pageKey } = await seedSkeleton();
    const result = (await addDashboardWidgetTool.handler(
      {
        widget_type: 'ui-group-dialog',
        opts: {
          label: 'Confirm Abort',
          page_key: pageKey,
          passthrough: { name: 'Confirm Abort', groupType: 'dialog', width: 6 },
        },
      },
      ctx,
    )) as { ok: boolean; appended_config_node: boolean };
    expect(result.ok).toBe(true);
    expect(result.appended_config_node).toBe(true);
  });

  it('rejects ui-group-dialog without page_key', async () => {
    await seedSkeleton();
    await expect(
      addDashboardWidgetTool.handler({ widget_type: 'ui-group-dialog', opts: {} }, ctx),
    ).rejects.toThrow(/requires opts\.page_key/);
  });
});

describe('add_dashboard_widget — unknown widget types', () => {
  it('rejects unknown widget_type', async () => {
    await seedSkeleton();
    await expect(
      addDashboardWidgetTool.handler({ tab_id: TAB_ID, widget_type: 'ui-nope', opts: {} }, ctx),
    ).rejects.toThrow(/'ui-nope' is not a known Dashboard 2\.0 widget/);
  });

  it('is registered as an author-tier tool', () => {
    expect(addDashboardWidgetTool.tier).toBe('author');
  });
});
