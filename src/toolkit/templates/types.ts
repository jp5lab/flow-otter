import type { AuthoringSpec } from '../authoring/types.js';

export type TemplateParamType = 'string' | 'number' | 'boolean';

export interface TemplateParameter {
  readonly name: string;
  readonly type: TemplateParamType;
  readonly description: string;
  readonly required?: boolean;
  readonly default?: string | number | boolean;
}

export type TemplateParams = Readonly<Record<string, unknown>>;

export interface TemplateDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly TemplateParameter[];
  instantiate(base: AuthoringSpec, params?: TemplateParams): AuthoringSpec;
}

export interface TemplateSummary {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly TemplateParameter[];
}
