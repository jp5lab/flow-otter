import { describe, expect, it } from 'vitest';

import { loadConfig, summarizeConfig } from '../../../../src/server/config/load.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const cfg = loadConfig({
      NODE_RED_BASE_URL: 'http://localhost:1880',
    });
    expect(cfg.READ_ONLY_MODE).toBe(true);
    expect(cfg.ENABLE_WRITE_TOOLS).toBe(false);
    expect(cfg.SNAPSHOT_RETENTION).toBe(50);
    expect(cfg.LINT_VIEWPORT_WINDOW_WIDTH).toBe(1920);
  });

  it('coerces booleans from strings', () => {
    const cfg = loadConfig({
      NODE_RED_BASE_URL: 'http://localhost:1880',
      ENABLE_WRITE_TOOLS: 'true',
      ENABLE_DEPLOY_TOOLS: '1',
      READ_ONLY_MODE: 'false',
    });
    expect(cfg.ENABLE_WRITE_TOOLS).toBe(true);
    expect(cfg.ENABLE_DEPLOY_TOOLS).toBe(true);
    expect(cfg.READ_ONLY_MODE).toBe(false);
  });

  it('allows admin-api source without NODE_RED_BASE_URL (target set later via set_target)', () => {
    const cfg = loadConfig({
      FLOW_SOURCE: 'admin-api',
    });
    expect(cfg.FLOW_SOURCE).toBe('admin-api');
    expect(cfg.NODE_RED_BASE_URL).toBeUndefined();
  });

  it('allows file source without NODE_RED_BASE_URL', () => {
    const cfg = loadConfig({
      FLOW_SOURCE: 'file',
      FLOW_FILE_PATH: '/tmp/flows.json',
    });
    expect(cfg.FLOW_SOURCE).toBe('file');
  });
});

describe('summarizeConfig', () => {
  it('redacts secret values', () => {
    const cfg = loadConfig({
      NODE_RED_BASE_URL: 'http://localhost:1880',
      NODE_RED_AUTH_TOKEN: 'super-secret',
    });
    const summary = summarizeConfig(cfg);
    expect(summary['NODE_RED_AUTH_TOKEN']).toBe('***SET***');
    expect(JSON.stringify(summary)).not.toContain('super-secret');
  });

  it('marks unset secrets as ***UNSET***', () => {
    const cfg = loadConfig({
      NODE_RED_BASE_URL: 'http://localhost:1880',
    });
    const summary = summarizeConfig(cfg);
    expect(summary['NODE_RED_AUTH_TOKEN']).toBe('***UNSET***');
  });
});
