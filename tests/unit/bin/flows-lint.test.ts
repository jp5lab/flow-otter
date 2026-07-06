import { describe, expect, it } from 'vitest';

import {
  exitCodeForReport,
  formatJson,
  parseArgs,
  type CliOptions,
} from '../../../bin/flows-lint.js';
import type { FlowLintReport } from '../../../src/toolkit/lint/flows-lint.js';

const BASE_OPTS: CliOptions = {
  format: 'json',
  severity: 'error',
  strict: false,
  quiet: false,
  verbose: false,
  layout: true,
  filePath: 'flows.json',
};

function layoutWarningReport(): FlowLintReport {
  return {
    diagnostics: [
      {
        severity: 'warning',
        rule: 'layout-backward-wires',
        message: 'Backward wire.',
      },
    ],
    errors: [],
    warnings: [
      {
        severity: 'warning',
        rule: 'layout-backward-wires',
        message: 'Backward wire.',
      },
    ],
    hasErrors: false,
    layout: {
      overall: 0.8,
      rules: [
        {
          rule: 'layout-backward-wires',
          score: 0,
          weight: 3,
          offender_count: 1,
          offenders: [{ wireId: 'w1' }],
        },
      ],
    },
  };
}

describe('flows-lint CLI helpers', () => {
  it('parses --no-layout as an additive opt-out', () => {
    const parsed = parseArgs(['--no-layout', 'flows.json']);

    expect(parsed).toMatchObject({ ok: true, opts: { layout: false, filePath: 'flows.json' } });
  });

  it('json output includes the layout block when present', () => {
    const payload = JSON.parse(formatJson(layoutWarningReport(), '/tmp/flows.json')) as {
      layout?: unknown;
    };

    expect(payload.layout).toEqual(layoutWarningReport().layout);
  });

  it('layout warnings do not change the default error-threshold exit code', () => {
    expect(exitCodeForReport(layoutWarningReport(), BASE_OPTS)).toBe(0);
    expect(exitCodeForReport(layoutWarningReport(), { ...BASE_OPTS, strict: true })).toBe(1);
  });
});
