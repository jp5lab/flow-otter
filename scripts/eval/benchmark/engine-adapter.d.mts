/** Hand-written declarations for engine-adapter.mjs (consumed by the unit suite). */

export interface LayoutEngineAdapter {
  readonly name: string;
  readonly version: string;
  layout(input: unknown, opts?: LayoutEngineAdapterOptions): Promise<unknown>;
}

export interface LayoutEngineAdapterOptions {
  readonly kind?: 'flows-json' | 'spec';
  readonly layoutOptions?: unknown;
}

export declare const identityAdapter: LayoutEngineAdapter;
export declare const layoutToolkitAdapter: LayoutEngineAdapter;
export declare function resolveAdapter(name: string): LayoutEngineAdapter;
