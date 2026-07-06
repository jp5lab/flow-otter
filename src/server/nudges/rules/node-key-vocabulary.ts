import { getNodeKeyResolutionGuidance } from '../../tools/author/_node-key-resolution.js';
import type { Nudge } from '../types.js';

const APPLIES_TO_TOOLS = new Set<string>([
  'add_debug_node',
  'add_group',
  'add_node',
  'move_node',
  'remove_node',
  'set_wires',
  'update_node',
  'wire_nodes',
]);

export const nodeKeyVocabularyNudge: Nudge = {
  id: 'node-key-vocabulary',
  description:
    'Hints node authoring-key vocabulary when an author tool accepted a Node-RED node id as a fallback.',
  applies: (toolName) => APPLIES_TO_TOOLS.has(toolName),
  check: (_ctx, _args, result) => {
    const resolutions = getNodeKeyResolutionGuidance(result);
    if (resolutions.length === 0) return null;
    if (resolutions.length === 1) {
      const r = resolutions[0]!;
      return (
        `Resolved Node-RED node id '${r.input}' to authoring key '${r.resolvedKey}'. ` +
        'Author tools address existing nodes by authoring key; get_flow shows both id and _authoringKey. ' +
        `Prefer ${r.field}:'${r.resolvedKey}' in future calls.`
      );
    }
    const pairs = resolutions
      .map((r) => `${r.field} '${r.input}' -> '${r.resolvedKey}'`)
      .join('; ');
    return (
      `Resolved Node-RED node ids to authoring keys: ${pairs}. ` +
      'Author tools address existing nodes by authoring key; get_flow shows both id and _authoringKey. ' +
      'Prefer the resolved keys in future calls.'
    );
  },
};
