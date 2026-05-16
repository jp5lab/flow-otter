export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly rule: string;
  readonly message: string;
  readonly nodeId?: string;
  readonly tabId?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface ValidationReport {
  readonly diagnostics: readonly Diagnostic[];
  readonly errors: readonly Diagnostic[];
  readonly warnings: readonly Diagnostic[];
  readonly hasErrors: boolean;
}

export function buildReport(diagnostics: readonly Diagnostic[]): ValidationReport {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  return {
    diagnostics,
    errors,
    warnings,
    hasErrors: errors.length > 0,
  };
}
