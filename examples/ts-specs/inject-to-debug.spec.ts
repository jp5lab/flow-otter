/**
 * Author-by-code reference for the Milestone A vertical slice.
 *
 * Compiles to a `flows.json` matching `tests/fixtures/inject-to-debug.flows.json`
 * (modulo IDs and `_authoringKey` extension fields). Run via:
 *
 *     npx tsx examples/ts-specs/inject-to-debug.spec.ts
 */

import { compile } from '../../src/toolkit/authoring/compile.js';
import { canonicalJson } from '../../src/shared/canonical-json.js';
import type { AuthoringSpec } from '../../src/toolkit/authoring/types.js';

const spec: AuthoringSpec = {
  tabs: [
    {
      id: 'main',
      label: 'Main',
      nodes: [
        {
          key: 'tick',
          type: 'inject',
          label: 'Tick',
          position: { x: 100, y: 100 },
          passthrough: {
            props: [],
            repeat: '',
            crontab: '',
            once: false,
            onceDelay: 0.1,
            topic: '',
            payload: '',
            payloadType: 'date',
          },
        },
      ],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

const { flows, hash } = compile(spec);
process.stdout.write(canonicalJson(flows) + '\n');
process.stderr.write(`hash: ${hash}\n`);
