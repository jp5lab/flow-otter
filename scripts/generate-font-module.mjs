#!/usr/bin/env node
/**
 * Generator for src/toolkit/render/fonts/inter-regular.ts — the bundled,
 * base64-embedded font that makes render_flow_png byte-stable on every
 * platform (no system-font dependence). REND-5.
 *
 * The bundled font is Inter Regular, © The Inter Project Authors
 * (https://github.com/rsms/inter), licensed under the SIL Open Font
 * License 1.1 (OFL-1.1). The full license text is embedded in the generated
 * module (so the published dist/ tarball carries it, per OFL §1) and kept
 * alongside as src/toolkit/render/fonts/OFL-Inter.txt; repo-level notice in
 * NOTICE.
 *
 * Provenance pipeline (run on 2026-06-10):
 *   1. npm pack @expo-google-fonts/inter@0.4.2   # ships OFL TTF builds
 *      → package/400Regular/Inter_400Regular.ttf (342 408 bytes)
 *      → package/LICENSE_FONT (OFL-1.1 text for Inter)
 *   2. Subset to Basic Latin + Latin-1 Supplement + common typographic
 *      punctuation with subset-font@2 (harfbuzzjs):
 *        node scripts/generate-font-module.mjs \
 *          --ttf Inter_400Regular.ttf --license LICENSE_FONT --subset
 *      (without --subset the TTF is embedded as-is; subset-font must be
 *      resolvable — `npm install --no-save subset-font@2` — it is NOT a
 *      repo dependency)
 *
 * Regenerating with the same inputs is byte-identical: the charset below is
 * fixed and subset-font/harfbuzz subsetting is deterministic for a given
 * input font + charset.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT_DIR = path.join(REPO_ROOT, 'src', 'toolkit', 'render', 'fonts');
const OUT_MODULE = path.join(OUT_DIR, 'inter-regular.ts');
const OUT_LICENSE = path.join(OUT_DIR, 'OFL-Inter.txt');

/** Fixed subset charset: Basic Latin + Latin-1 Supplement + typographic marks. */
export function subsetCharset() {
  let chars = '';
  for (let c = 0x20; c <= 0x7e; c++) chars += String.fromCharCode(c);
  for (let c = 0xa0; c <= 0xff; c++) chars += String.fromCharCode(c);
  chars += '–—‘’“”…•→';
  return chars;
}

function parseArgs(argv) {
  const args = { ttf: undefined, license: undefined, subset: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ttf') args.ttf = argv[++i];
    else if (a === '--license') args.license = argv[++i];
    else if (a === '--subset') args.subset = true;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if (!args.ttf || !args.license) {
    console.error(
      'usage: node scripts/generate-font-module.mjs --ttf <font.ttf> --license <OFL.txt> [--subset]',
    );
    process.exit(2);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let ttf = readFileSync(args.ttf);
  const license = readFileSync(args.license, 'utf8');

  if (args.subset) {
    // subset-font is NOT a repo dependency — resolve it from the invoking
    // directory (`npm install --no-save subset-font@2` there first).
    const { createRequire } = await import('node:module');
    const cwdRequire = createRequire(path.join(process.cwd(), 'noop.js'));
    const subsetFont = cwdRequire('subset-font');
    ttf = await subsetFont(ttf, subsetCharset(), { targetFormat: 'truetype' });
  }

  if (ttf.readUInt32BE(0) !== 0x00010000) {
    console.error('input does not look like a TTF (sfnt version != 0x00010000)');
    process.exit(2);
  }

  const base64 = ttf.toString('base64');
  // Template-literal safety for the embedded license text.
  const licenseEscaped = license
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');

  const moduleSource = `/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: node scripts/generate-font-module.mjs (see its header
 * for the full provenance pipeline).
 *
 * Inter Regular (latin subset), © The Inter Project Authors
 * (https://github.com/rsms/inter), licensed under the SIL Open Font
 * License 1.1. Source artifact: @expo-google-fonts/inter@0.4.2
 * package/400Regular/Inter_400Regular.ttf, subset to Basic Latin +
 * Latin-1 Supplement + common typographic punctuation with subset-font@2.
 *
 * The license text is embedded below (INTER_OFL_LICENSE) so every
 * distribution of this module — including the compiled dist/ in the npm
 * tarball — carries it, as the OFL requires. A plain-text copy lives
 * alongside at src/toolkit/render/fonts/OFL-Inter.txt.
 */

/** Font family name recorded in the embedded TTF's name table. */
export const INTER_REGULAR_FAMILY: string = 'Inter';

/**
 * Subset TTF bytes (${String(ttf.length)} bytes), base64-encoded.
 * (The explicit ': string' annotations keep the emitted .d.ts from
 * inlining the literals as types, which would double the tarball cost.)
 */
export const INTER_REGULAR_TTF_BASE64: string =
  '${base64}';

/** SIL Open Font License 1.1 text covering the embedded font. */
export const INTER_OFL_LICENSE: string = \`${licenseEscaped}\`;
`;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_MODULE, moduleSource, 'utf8');
  writeFileSync(OUT_LICENSE, license, 'utf8');
  console.log(`wrote ${OUT_MODULE} (${String(ttf.length)} font bytes embedded)`);
  console.log(`wrote ${OUT_LICENSE}`);
}

await main();
