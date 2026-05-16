import type { AuthoringSpec } from '../authoring/types.js';

import { BUILTIN_TEMPLATES } from './builtin.js';
import type { TemplateDefinition, TemplateParams, TemplateSummary } from './types.js';

export class TemplateNotFoundError extends Error {
  constructor(name: string) {
    super(`Template '${name}' not found.`);
    this.name = 'TemplateNotFoundError';
  }
}

export function listTemplates(): TemplateSummary[] {
  return BUILTIN_TEMPLATES.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export function getTemplate(name: string): TemplateDefinition {
  const found = BUILTIN_TEMPLATES.find((t) => t.name === name);
  if (!found) throw new TemplateNotFoundError(name);
  return found;
}

export function instantiateTemplate(
  base: AuthoringSpec,
  name: string,
  params?: TemplateParams,
): AuthoringSpec {
  return getTemplate(name).instantiate(base, params);
}

export type {
  TemplateDefinition,
  TemplateParameter,
  TemplateParams,
  TemplateSummary,
} from './types.js';
