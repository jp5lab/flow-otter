import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ALL_TOOLS } from '../../../../../src/server/index.js';
import { STAGED_AUTHOR_TOOL_LIFECYCLE_SENTENCE } from '../../../../../src/server/tools/author/_stage-pipeline.js';

const EXPECTED_STAGED_AUTHOR_TOOLS = [
  'add_catch_node',
  'add_comment',
  'add_complete_node',
  'add_config_node',
  'add_dashboard_widget',
  'add_debug_node',
  'add_function_node',
  'add_group',
  'add_inject_node',
  'add_link_call_node',
  'add_link_in_node',
  'add_link_out_node',
  'add_mqtt_in_node',
  'add_mqtt_out_node',
  'add_node',
  'add_status_node',
  'add_subflow_instance',
  'create_subflow_definition',
  'instantiate_template',
  'move_node',
  'remove_group',
  'remove_node',
  'set_links',
  'set_wires',
  'stage_changes',
  'update_comment',
  'update_group',
  'update_node',
  'wire_nodes',
] as const;

function isZodObject(schema: z.ZodType<unknown>): schema is z.ZodObject<z.ZodRawShape> {
  return schema instanceof z.ZodObject;
}

function hasSuccessfulStagedHashOutput(tool: (typeof ALL_TOOLS)[number]): boolean {
  if (tool.tier !== 'author') return false;
  if (tool.outputZod === undefined || !isZodObject(tool.outputZod)) return false;

  const stagedHash = tool.outputZod.shape['staged_hash'];
  return stagedHash instanceof z.ZodString;
}

describe('staged author tool descriptions', () => {
  it('pinpoints the author tools that stage through the shared pipeline', () => {
    const names = ALL_TOOLS.filter(hasSuccessfulStagedHashOutput)
      .map((tool) => tool.name)
      .sort();

    expect(names).toEqual([...EXPECTED_STAGED_AUTHOR_TOOLS]);
  });

  it('append the single-slot lifecycle sentence to every staging tool description', () => {
    const stagedAuthorTools = ALL_TOOLS.filter(hasSuccessfulStagedHashOutput);

    for (const tool of stagedAuthorTools) {
      expect(
        tool.description.endsWith(STAGED_AUTHOR_TOOL_LIFECYCLE_SENTENCE),
        `${tool.name} description must end with the staging lifecycle sentence`,
      ).toBe(true);
    }
  });
});
