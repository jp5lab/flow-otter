/**
 * EVAL-4 — S6 layout engine adapter seam (fix plan §3 EVAL-4).
 *
 * The scored runner calls exactly this adapter boundary. The real adapter
 * imports dist lazily from layout(), so plumbing mode and freeze/unit tests do
 * not require a built toolkit.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGE_PATH = join(REPO_ROOT, 'package.json');

function packageVersion() {
  return JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')).version;
}

function distUrl(path) {
  return pathToFileURL(join(REPO_ROOT, path)).href;
}

export const identityAdapter = Object.freeze({
  name: 'identity-stub',
  version: 'pre-layo-4',
  async layout(input, _opts = {}) {
    return input;
  },
});

export const layoutToolkitAdapter = Object.freeze({
  name: 'layout-toolkit',
  version: packageVersion(),
  async layout(input, opts = {}) {
    const layout = await import(distUrl('dist/src/toolkit/layout/index.js'));
    if (opts.kind === 'spec') {
      return layout.layoutFlows(input, opts.layoutOptions ?? {});
    }
    return layout.layoutFlowsJson(input, opts.layoutOptions ?? {});
  },
});

export function resolveAdapter(name) {
  if (name === identityAdapter.name) return identityAdapter;
  if (name === layoutToolkitAdapter.name) return layoutToolkitAdapter;
  throw new Error(`unknown engine adapter '${name}'`);
}
