/** Hand-written declarations for freeze.mjs (consumed by the unit suite). */

import type { PathLike } from 'node:fs';

export interface FrozenHashes {
  thresholdsSha: string;
  protocolSha: string;
}

export interface FreezeCheck {
  file: string;
  expected: string;
  actual: string;
  ok: boolean;
  superseded?: boolean;
}

export interface VerifyFreezeResult {
  ok: boolean;
  checks: FreezeCheck[];
}

export declare function sha256File(path: PathLike): string;
export declare function readFrozenHashes(opts: {
  protocolPath: PathLike;
  designPath: PathLike;
}): FrozenHashes;
export declare function verifyFreeze(opts: {
  thresholdsPath: PathLike;
  protocolPath: PathLike;
  designPath: PathLike;
  supersededThresholdsSha?: string;
}): VerifyFreezeResult;
