import { describe, expect, it } from 'vitest';

import type { ToolContentBlock } from '../../../../src/server/tools/_tool.js';
import {
  buildCallToolSuccessResult,
  buildSuccessContent,
} from '../../../../src/server/transport/stdio.js';

/**
 * REND-5 — stdio success-path content regression.
 *
 * The CallTool handler routes every success through `buildSuccessContent`.
 * For the (overwhelmingly common) tools WITHOUT a `buildContent` hook the
 * wire format must remain byte-identical to the pre-REND-5 transport:
 * exactly one text block containing `JSON.stringify(result, null, 2)`.
 * Tools WITH the hook own their content array verbatim.
 */

describe('buildSuccessContent (stdio default-path pin)', () => {
  it('no buildContent hook: single pretty-JSON text block, byte-identical to legacy', async () => {
    const result = {
      ok: true,
      staged_hash: 'abc123',
      nested: { values: [1, 2, 3], note: 'unicode → preserved' },
      nullable: null,
    };
    const content = await buildSuccessContent({}, result, { some: 'input' });
    expect(content).toEqual([{ type: 'text', text: JSON.stringify(result, null, 2) }]);
    // Byte-level: exactly the legacy serialization, including 2-space indent.
    expect(content[0]!.type).toBe('text');
    expect((content[0] as { text: string }).text).toBe(JSON.stringify(result, null, 2));
  });

  it('primitive and array results keep the legacy serialization too', async () => {
    for (const result of ['plain string', 42, [1, 'two', null], null]) {
      const content = await buildSuccessContent({}, result, undefined);
      expect(content).toEqual([{ type: 'text', text: JSON.stringify(result, null, 2) }]);
    }
  });

  it('buildContent hook: its return is used verbatim and receives (output, input)', async () => {
    const calls: unknown[][] = [];
    const blocks: ToolContentBlock[] = [
      { type: 'text', text: 'custom' },
      { type: 'image', data: 'aGk=', mimeType: 'image/png' },
    ];
    const tool = {
      buildContent: (output: unknown, input: unknown): ToolContentBlock[] => {
        calls.push([output, input]);
        return blocks;
      },
    };
    const content = await buildSuccessContent(tool, { a: 1 }, { b: 2 });
    expect(content).toBe(blocks);
    expect(calls).toEqual([[{ a: 1 }, { b: 2 }]]);
  });

  it('async buildContent hooks are awaited', async () => {
    const tool = {
      buildContent: (): Promise<ToolContentBlock[]> =>
        Promise.resolve([{ type: 'text', text: 'async' }]),
    };
    const content = await buildSuccessContent(tool, {}, {});
    expect(content).toEqual([{ type: 'text', text: 'async' }]);
  });

  it('schema-backed success results include structuredContent matching the JSON text block', async () => {
    const result = {
      ok: true,
      staged_hash: 'abc123',
      nested: { values: [1, 2, 3] },
      _guidance: [{ message: 'review staged diff' }],
    };
    const response = await buildCallToolSuccessResult(
      {
        outputJsonSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
        },
      },
      result,
      {},
    );

    expect(response.structuredContent).toEqual(result);
    expect(response.content).toHaveLength(1);
    const text = response.content[0];
    expect(text?.type).toBe('text');
    expect(JSON.parse((text as { text: string }).text)).toEqual(response.structuredContent);
  });

  it('success results without outputSchema keep content-only shape', async () => {
    const response = await buildCallToolSuccessResult({}, { ok: true }, {});
    expect(response).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
    });
  });
});
