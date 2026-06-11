import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { isTab, type FlowsJson } from '../../../shared/flows-json.js';
import { rasterizeSvg } from '../../../toolkit/render/png.js';
import { renderGeometry, renderSvg } from '../../../toolkit/render/svg.js';
import { ValidationFailedError, type Tool, type ToolContentBlock } from '../_tool.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1),
    against: z.enum(['staged', 'runtime']).optional(),
    output_path: z.string().min(1).optional(),
    scale: z.number().gt(0).max(4).optional(),
    include_geometry: z.boolean().optional(),
    return_image: z.boolean().optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const GeometryPortSchema = z.object({
  kind: z.enum(['input', 'output']),
  index: z.number(),
  x: z.number(),
  y: z.number(),
});

const GeometryEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['node', 'junction', 'group', 'comment']),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  ports: z.array(GeometryPortSchema),
});

const OutputSchema = z.object({
  rev: z.string().nullable(),
  tab_id: z.string(),
  against: z.enum(['staged', 'runtime']),
  staged_hash: z.string().nullable(),
  based_on_snapshot_hash: z.string().nullable(),
  png_path: z.string(),
  width_px: z.number().int(),
  height_px: z.number().int(),
  geometry: z.array(GeometryEntrySchema).optional(),
});
type Output = z.infer<typeof OutputSchema>;

/** Path-safe file-name fragment from a Node-RED tab id. */
function sanitizeForFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/**
 * Validate an agent-supplied output path: absolute, and inside the user's
 * home directory or the OS temp directory (same containment rationale as
 * `validateUserSuppliedStatePath`, plus tmp for scratch renders). Operators
 * who need a different root can set the RENDER_DIR env var at startup and
 * omit `output_path`.
 */
function assertSafeOutputPath(candidate: string): void {
  if (!path.isAbsolute(candidate)) {
    throw new ValidationFailedError(`output_path '${candidate}' must be an absolute path.`, [
      { rule: 'render/output-path', reason: 'not-absolute', value: candidate },
    ]);
  }
  const resolved = path.resolve(candidate);
  const home = path.resolve(os.homedir());
  const tmp = path.resolve(os.tmpdir());
  const inside = (root: string): boolean =>
    resolved === root || resolved.startsWith(root + path.sep);
  if (!inside(home) && !inside(tmp)) {
    throw new ValidationFailedError(
      `output_path '${candidate}' resolves outside the user's home directory (${home}) and the OS temp directory (${tmp}). Omit output_path to write under RENDER_DIR instead.`,
      [{ rule: 'render/output-path', reason: 'outside-home', value: candidate, resolved }],
    );
  }
}

/** Atomic buffer write: temp file in the destination dir, then rename. */
async function safeWrite(filePath: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${String(process.pid)}`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, filePath);
}

export const renderFlowPngTool: Tool<Input, Output> = {
  name: 'render_flow_png',
  description:
    'Renders a single tab to a PNG file on disk and returns its path (read the file to SEE the ' +
    "flow). against:'staged' renders the pending staged change; the default ('runtime') renders " +
    'the deployed runtime flows, which do NOT include any pending staged change. ' +
    'include_geometry:true adds the per-node {id,x,y,w,h,ports[]} geometry array. ' +
    'return_image:true additionally returns the PNG as an inline MCP image block (most CLI ' +
    'clients should read png_path from disk instead). Requires the optional @resvg/resvg-js ' +
    'dependency — fails loudly with RasterizerUnavailableError when it is not installed ' +
    '(see health_check.rasterizer_available). Read-only authoring-wise; writes only the PNG file.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      against: {
        type: 'string',
        enum: ['staged', 'runtime'],
        description:
          "What to render: 'staged' = the pending staged change (errors if the staging slot is " +
          "empty), 'runtime' = the deployed runtime flows (default).",
      },
      output_path: {
        type: 'string',
        minLength: 1,
        description:
          'Absolute path for the PNG (must resolve inside the home or OS temp directory). ' +
          'Default: <RENDER_DIR>/render-<tab_id>-<against>.png, overwritten per render.',
      },
      scale: {
        type: 'number',
        exclusiveMinimum: 0,
        maximum: 4,
        description: 'Zoom factor applied to the intrinsic SVG size (default 1, max 4).',
      },
      include_geometry: {
        type: 'boolean',
        description:
          'When true, the output includes the renderGeometry array: per-object ' +
          '{id, kind, x, y, w, h, ports[]} in canvas coordinates (default false).',
      },
      return_image: {
        type: 'boolean',
        description:
          'When true, the tool result additionally carries an inline base64 image content ' +
          'block. Default false — clients that read files from disk should use png_path.',
      },
    },
    required: ['tab_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const against = input.against ?? 'runtime';
    if (input.output_path !== undefined) assertSafeOutputPath(input.output_path);
    let flows: FlowsJson;
    let rev: string | null;
    let stagedHash: string | null = null;
    let basedOnSnapshotHash: string | null = null;
    if (against === 'staged') {
      const staged = await ctx.staging.read();
      if (!staged) {
        throw new ValidationFailedError(
          "No staged change to render. Stage a change with an author tool first, or call render_flow_png with against:'runtime' (the default) to render the deployed flows.",
          [
            {
              severity: 'error',
              rule: 'staging/no-staged-change',
              message:
                "render_flow_png(against:'staged') requires a pending staged change, but the staging slot is empty. Use get_staged_change to inspect staging state.",
            },
          ],
        );
      }
      flows = staged.flows;
      // The runtime rev the staged change was computed against — the same
      // provenance get_staged_change reports as based_on_rev.
      rev = staged.basedOnRev;
      stagedHash = staged.stagedHash;
      basedOnSnapshotHash = staged.basedOnSnapshotHash;
    } else {
      ({ flows, rev } = await ctx.flowSource.load());
    }
    const tab = flows.find((n) => isTab(n) && n.id === input.tab_id);
    if (!tab) {
      throw new ValidationFailedError(
        `Tab '${input.tab_id}' not found${against === 'staged' ? ' in the staged change' : ''}.`,
        [],
      );
    }
    const svg = renderSvg(flows, { tabId: input.tab_id });
    // HARD-FAIL: rasterizeSvg throws RasterizerUnavailableError when
    // @resvg/resvg-js is not loadable. Never substitute SVG for the PNG.
    const { png, width_px, height_px } = await rasterizeSvg(svg, {
      ...(input.scale !== undefined ? { scale: input.scale } : {}),
    });
    const pngPath =
      input.output_path ??
      path.join(
        ctx.config.RENDER_DIR,
        `render-${sanitizeForFilename(input.tab_id)}-${against}.png`,
      );
    await safeWrite(pngPath, png);
    return {
      rev,
      tab_id: input.tab_id,
      against,
      staged_hash: stagedHash,
      based_on_snapshot_hash: basedOnSnapshotHash,
      png_path: pngPath,
      width_px,
      height_px,
      ...(input.include_geometry === true ? { geometry: renderGeometry(flows, input.tab_id) } : {}),
    };
  },
  buildContent: async (output, input): Promise<ToolContentBlock[]> => {
    // The JSON text block is byte-identical to the transport's default
    // content path; the image block is strictly additive and opt-in.
    const text: ToolContentBlock = { type: 'text', text: JSON.stringify(output, null, 2) };
    if (input.return_image !== true) return [text];
    const data = await readFile(output.png_path);
    return [text, { type: 'image', data: data.toString('base64'), mimeType: 'image/png' }];
  },
};
