#!/usr/bin/env node
import { SERVER_INFO, startServer } from '../src/server/index.js';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write(`${SERVER_INFO.version}\n`);
} else if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: flow-otter [--version] [--help]',
      '',
      'Runs the FlowOtter server (Node-RED MCP) over stdio. Configure runtime access with environment',
      'variables, or call the set_target tool at runtime to point at a Node-RED Admin API.',
    ].join('\n') + '\n',
  );
} else {
  startServer().catch((err: unknown) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
