import { z } from 'zod';
import {
  extractTemplatePlaceholders,
  type MetaTemplate,
  type MetaTemplateSendParameters,
} from './meta-graph-client.service.ts';

export const WHATSAPP_TEMPLATE_METADATA_KEY = 'whatsappTemplate';

const VariablesSchema = z.record(z.string(), z.string());

const TemplateSendSchema = z.object({
  name: z.string().min(1),
  language: z.string().min(1),
  category: z.string().optional(),
  parameterFormat: z.enum(['positional', 'named']),
  variables: VariablesSchema,
  headerVariables: VariablesSchema.optional(),
});

export type WhatsAppTemplateSend = z.infer<typeof TemplateSendSchema>;

export interface WhatsAppTemplateDto {
  name: string;
  language: string;
  category: string;
  status: string;
  parameterFormat: 'positional' | 'named';
  headerText: string | null;
  bodyText: string | null;
  footerText: string | null;
  buttons: Array<{ type: string; text: string | null }>;
  variables: string[];
  headerVariables: string[];
}

export function readWhatsAppTemplateSend(metadata: unknown): WhatsAppTemplateSend | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>)[WHATSAPP_TEMPLATE_METADATA_KEY];
  if (!raw) return null;
  const parsed = TemplateSendSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function toTemplateSendParameters(template: WhatsAppTemplateSend): MetaTemplateSendParameters {
  return {
    header: toParameterList(template.headerVariables ?? {}, template.parameterFormat),
    body: toParameterList(template.variables, template.parameterFormat),
  };
}

export function toTemplateDto(template: MetaTemplate): WhatsAppTemplateDto {
  const header = template.components.find((c) => c.type === 'header');
  const body = template.components.find((c) => c.type === 'body');
  const footer = template.components.find((c) => c.type === 'footer');
  const buttons = template.components.find((c) => c.type === 'buttons');
  const headerText = header?.format === 'text' || (!header?.format && header?.text) ? header?.text ?? null : null;
  return {
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    parameterFormat: template.parameterFormat,
    headerText,
    bodyText: body?.text ?? null,
    footerText: footer?.text ?? null,
    buttons: (buttons?.buttons ?? []).map((b) => ({ type: b.type, text: b.text ?? null })),
    variables: extractTemplatePlaceholders(body?.text),
    headerVariables: extractTemplatePlaceholders(headerText ?? undefined),
  };
}

export function validateTemplateVariables(
  template: WhatsAppTemplateDto,
  variables: Record<string, string>,
  headerVariables: Record<string, string>,
): string | null {
  const problems: string[] = [];
  const check = (label: string, expected: string[], given: Record<string, string>): void => {
    const missing = expected.filter((name) => !given[name]?.trim());
    const extra = Object.keys(given).filter((name) => !expected.includes(name));
    if (missing.length > 0) problems.push(`${label} missing ${missing.map((n) => `{{${n}}}`).join(', ')}`);
    if (extra.length > 0) problems.push(`${label} has unknown ${extra.map((n) => `{{${n}}}`).join(', ')}`);
  };
  check('variables', template.variables, variables);
  check('headerVariables', template.headerVariables, headerVariables);
  const malformed = [...Object.entries(variables), ...Object.entries(headerVariables)]
    .filter(([, value]) => /[\n\t]| {5,}/.test(value))
    .map(([name]) => `{{${name}}}`);
  if (malformed.length > 0) {
    problems.push(`${malformed.join(', ')} contain a newline, tab or run of spaces, which WhatsApp rejects`);
  }
  return problems.length > 0 ? problems.join('; ') : null;
}

export function renderTemplateText(
  template: WhatsAppTemplateDto,
  variables: Record<string, string>,
  headerVariables: Record<string, string>,
): string {
  const parts = [
    template.headerText ? substitute(template.headerText, headerVariables) : null,
    template.bodyText ? substitute(template.bodyText, variables) : null,
    template.footerText,
  ];
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join('\n\n');
}

function substitute(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => values[name] ?? match);
}

function toParameterList(
  values: Record<string, string>,
  format: 'positional' | 'named',
): Array<{ name?: string; text: string }> {
  const entries = Object.entries(values);
  if (format === 'named') return entries.map(([name, text]) => ({ name, text }));
  return entries
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, text]) => ({ text }));
}
