/**
 * EVAL-4 — pure S6 scoring math.
 *
 * Kept separate from the runner so threshold boundaries and verdict logic can
 * be pinned without importing the layout engine.
 */

export const SCORE_EPSILON = 1e-9;

export function overallDelta(baselineOverall, engineOverall) {
  return engineOverall - baselineOverall;
}

export function notWorse(delta, epsilon = SCORE_EPSILON) {
  return delta >= -epsilon;
}

export function ruleDeltas(baselineRules, engineRules) {
  const engineByRule = new Map(engineRules.map((rule) => [rule.rule, rule]));
  const seen = new Set();
  const rows = baselineRules.map((baseline) => {
    seen.add(baseline.rule);
    const engine = engineByRule.get(baseline.rule);
    return {
      rule: baseline.rule,
      baseline_score: baseline.score,
      engine_score: engine?.score ?? null,
      delta: engine === undefined ? null : overallDelta(baseline.score, engine.score),
      baseline_offender_count: baseline.offender_count,
      engine_offender_count: engine?.offender_count ?? null,
    };
  });

  for (const engine of [...engineRules].sort((a, b) => a.rule.localeCompare(b.rule))) {
    if (seen.has(engine.rule)) continue;
    rows.push({
      rule: engine.rule,
      baseline_score: null,
      engine_score: engine.score,
      delta: null,
      baseline_offender_count: null,
      engine_offender_count: engine.offender_count,
    });
  }

  return rows;
}

export function summarizeScores(rows) {
  const scoredRows = rows.filter((row) => row.status === 'scored');
  const crashes = rows.filter((row) => row.status === 'crashed').length;
  const notWorseRate =
    scoredRows.length === 0
      ? 0
      : scoredRows.filter((row) => row.not_worse === true).length / scoredRows.length;
  const semanticsPassAll =
    scoredRows.length > 0 && scoredRows.every((row) => row.semantics_pass === true);
  const verdict =
    crashes === 0 && notWorseRate === 1 && semanticsPassAll === true ? 'PASS' : 'FAIL';

  return {
    not_worse_rate: notWorseRate,
    crashes,
    semantics_pass_all: semanticsPassAll,
    verdict,
  };
}
