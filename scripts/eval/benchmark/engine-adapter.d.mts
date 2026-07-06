/** Hand-written declarations for engine-adapter.mjs (consumed by the unit suite). */

export interface LayoutEngineAdapter {
  readonly name: string;
  readonly version: string;
  layout(strippedSpec: unknown, opts?: unknown): Promise<unknown>;
}

export declare const identityAdapter: LayoutEngineAdapter;
export declare function resolveAdapter(name: string): LayoutEngineAdapter;
