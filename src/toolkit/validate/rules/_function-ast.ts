import { Parser } from 'acorn';
import type { Program } from 'acorn';

export interface ParseFailure {
  readonly ok: false;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ParseSuccess {
  readonly ok: true;
  readonly program: Program;
}

export type ParseResult = ParseSuccess | ParseFailure;

export function parseFunctionNodeJs(code: string): ParseResult {
  try {
    const program = Parser.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      locations: true,
    });
    return { ok: true, program };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const loc = err as { loc?: { line?: number; column?: number } };
    const line = loc.loc?.line;
    const column = loc.loc?.column;
    return {
      ok: false,
      message,
      ...(typeof line === 'number' ? { line } : {}),
      ...(typeof column === 'number' ? { column } : {}),
    };
  }
}
