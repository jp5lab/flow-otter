import { describe, expect, it } from 'vitest';

import { SERVER_INSTRUCTIONS } from '../../../src/server/index.js';

describe('SERVER_INSTRUCTIONS', () => {
  // Claude Code truncates server `instructions` at 2KB. Keep this ceiling
  // enforced so future edits don't silently overflow.
  it('fits within the 2000-character Claude Code instructions budget', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2000);
  });

  // The four-phase pipeline is the heart of the methodology. Lock it in.
  it.each(['PLAN', 'ORGANIZE', 'STRUCTURE', 'REVIEW', 'DEPLOY'])(
    'mentions phase marker %s',
    (phase) => {
      expect(SERVER_INSTRUCTIONS).toContain(phase);
    },
  );

  it.each([
    'plan_flow',
    'get_authoring_guide',
    'preview_flow_diff',
    'deploy_staged_change',
    'render_flow_svg',
    'render_flow_png',
    'validate_flow',
    'list_available_toolsets',
    'enable_toolset',
    'add_node',
    'stage_changes',
    'create_subflow_definition',
    'set_target',
    'health_check',
  ])('references tool %s', (toolName) => {
    expect(SERVER_INSTRUCTIONS).toContain(toolName);
  });

  it('advertises shipped batch staging', () => {
    expect(SERVER_INSTRUCTIONS).toContain('stage_changes batches many ops into ONE staged change.');
  });

  // D-5 (R6/F4): the layout conventions are taught WITH NUMBERS, in-band.
  // These exact tokens are the fix plan's pinned assertion set — 20px grid,
  // 140-220px column pitch, error lane ≥120px BELOW, switch port 0 on top,
  // ≤1420px visible viewport.
  it.each(['20px', '140-220', 'BELOW', 'port 0', '1420', '120'])(
    'teaches layout convention token %s',
    (token) => {
      expect(SERVER_INSTRUCTIONS).toContain(token);
    },
  );

  // The PNG channel is consumed by reading png_path from disk — the
  // instructions must say so (REND-5 handed this one-line mention to D-5).
  it('tells the agent to Read the render_flow_png png_path from disk', () => {
    expect(SERVER_INSTRUCTIONS).toContain('png_path');
  });

  it('points at the layout_conventions catalog category', () => {
    expect(SERVER_INSTRUCTIONS).toContain('layout_conventions');
  });

  // Document the four anchor decisions in the playbook so the agent has them
  // in working memory: specialists are opt-in (author_specialists toolset),
  // dashboards follow ISA-101, version-gated features exist, no credentials.
  it.each(['author_specialists', 'ISA-101', 'capabilities', 'CREDENTIALS', 'credential-leak'])(
    'references anchor concept %s',
    (concept) => {
      expect(SERVER_INSTRUCTIONS).toContain(concept);
    },
  );

  it('is non-empty after construction', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(500);
  });
});
