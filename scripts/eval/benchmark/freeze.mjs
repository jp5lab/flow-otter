/**
 * EVAL-4-skeleton — S6 frozen threshold/protocol verification.
 *
 * The docs are the source of truth: PROTOCOL.md records the thresholds hash,
 * while docs/DESIGN.md records PROTOCOL.md's final hash to avoid a
 * self-referential digest. Scored mode must refuse when either record drifts.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SHA256_RE = '[0-9a-f]{64}';

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

export function readFrozenHashes({ protocolPath, designPath }) {
  const protocol = readText(protocolPath);
  const thresholdMatch = protocol.match(
    new RegExp(
      `Frozen threshold hash:[\\s\\S]*?\`eval/benchmark/thresholds\\.json\`\\s+sha256:\\s+\`(${SHA256_RE})\``,
      'u',
    ),
  );
  if (thresholdMatch === null) {
    throw new Error(
      `freeze violation: could not find Frozen threshold hash for eval/benchmark/thresholds.json in ${protocolPath}`,
    );
  }

  const design = readText(designPath);
  const protocolMatch = design.match(
    new RegExp(
      `EVAL-3 pre-registration hashes recorded\\.[\\s\\S]*?\`eval/benchmark/PROTOCOL\\.md\`\\s+sha256\\s+\`(${SHA256_RE})\``,
      'u',
    ),
  );
  if (protocolMatch === null) {
    throw new Error(
      `freeze violation: could not find EVAL-3 PROTOCOL.md sha256 record in ${designPath}`,
    );
  }

  return { thresholdsSha: thresholdMatch[1], protocolSha: protocolMatch[1] };
}

export function verifyFreeze({
  thresholdsPath,
  protocolPath,
  designPath,
  supersededThresholdsSha = undefined,
}) {
  const frozen = readFrozenHashes({ protocolPath, designPath });
  const actualThresholdsSha = sha256File(thresholdsPath);
  const actualProtocolSha = sha256File(protocolPath);
  const normalizedSuperseded =
    typeof supersededThresholdsSha === 'string' ? supersededThresholdsSha.toLowerCase() : undefined;

  const thresholdSuperseded =
    frozen.thresholdsSha !== actualThresholdsSha && normalizedSuperseded === actualThresholdsSha;
  const checks = [
    {
      file: 'eval/benchmark/thresholds.json',
      expected: frozen.thresholdsSha,
      actual: actualThresholdsSha,
      ok: frozen.thresholdsSha === actualThresholdsSha || thresholdSuperseded,
      ...(thresholdSuperseded ? { superseded: true } : {}),
    },
    {
      file: 'eval/benchmark/PROTOCOL.md',
      expected: frozen.protocolSha,
      actual: actualProtocolSha,
      ok: frozen.protocolSha === actualProtocolSha,
    },
  ];

  return { ok: checks.every((c) => c.ok), checks };
}
