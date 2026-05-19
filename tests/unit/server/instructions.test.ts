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
    'validate_flow',
    'list_available_toolsets',
    'enable_toolset',
    'add_node',
    'create_subflow_definition',
    'set_target',
    'health_check',
  ])('references tool %s', (toolName) => {
    expect(SERVER_INSTRUCTIONS).toContain(toolName);
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
