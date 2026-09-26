import type { MessageDto, WhatsAppWindowDto } from './inbox-types';

export interface WhatsAppWindowState {
  open: boolean;
  remainingMs: number | null;
}

export function whatsappWindowState(
  windowDto: WhatsAppWindowDto | null | undefined,
  now: number,
): WhatsAppWindowState | null {
  if (!windowDto) return null;
  const closesAt = windowDto.closesAt ? new Date(windowDto.closesAt).getTime() : NaN;
  if (!Number.isFinite(closesAt)) return { open: windowDto.open, remainingMs: null };
  const remainingMs = closesAt - now;
  return remainingMs > 0 ? { open: true, remainingMs } : { open: false, remainingMs: null };
}

export function splitRemaining(ms: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export interface WhatsAppTemplateOption {
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

export interface TemplateField {
  scope: 'header' | 'body';
  name: string;
}

export interface TemplateValues {
  header: Record<string, string>;
  body: Record<string, string>;
}

export const EMPTY_TEMPLATE_VALUES: TemplateValues = { header: {}, body: {} };

export function templateKey(template: Pick<WhatsAppTemplateOption, 'name' | 'language'>): string {
  return `${template.name}::${template.language}`;
}

export function templateFields(template: WhatsAppTemplateOption): TemplateField[] {
  return [
    ...template.headerVariables.map((name) => ({ scope: 'header' as const, name })),
    ...template.variables.map((name) => ({ scope: 'body' as const, name })),
  ];
}

export function missingTemplateFields(
  template: WhatsAppTemplateOption,
  values: TemplateValues,
): TemplateField[] {
  return templateFields(template).filter((field) => !values[field.scope][field.name]?.trim());
}

export function substitutePlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => {
    const value = values[name]?.trim();
    return value ? value : match;
  });
}

export interface TemplatePreview {
  header: string | null;
  body: string | null;
  footer: string | null;
  buttons: string[];
}

export function renderTemplatePreview(
  template: WhatsAppTemplateOption,
  values: TemplateValues,
): TemplatePreview {
  return {
    header: template.headerText ? substitutePlaceholders(template.headerText, values.header) : null,
    body: template.bodyText ? substitutePlaceholders(template.bodyText, values.body) : null,
    footer: template.footerText,
    buttons: template.buttons
      .map((b) => b.text)
      .filter((text): text is string => !!text && text.trim().length > 0),
  };
}

export function templateSendBody(
  template: WhatsAppTemplateOption,
  values: TemplateValues,
): {
  templateName: string;
  language: string;
  variables?: Record<string, string>;
  headerVariables?: Record<string, string>;
} {
  const pick = (names: string[], source: Record<string, string>): Record<string, string> =>
    Object.fromEntries(names.map((name) => [name, source[name]?.trim() ?? '']));
  return {
    templateName: template.name,
    language: template.language,
    ...(template.variables.length > 0 ? { variables: pick(template.variables, values.body) } : {}),
    ...(template.headerVariables.length > 0
      ? { headerVariables: pick(template.headerVariables, values.header) }
      : {}),
  };
}

export type TranscriptionState =
  | { status: 'pending' }
  | { status: 'done' }
  | { status: 'failed'; error: string | null };

export interface WhatsAppMessageMeta {
  template: { name: string; language: string | null } | null;
  voiceNote: TranscriptionState | null;
  reaction: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readWhatsAppMessageMeta(metadata: Record<string, unknown>): WhatsAppMessageMeta {
  const template = asRecord(metadata.whatsappTemplate);
  const transcription = asRecord(metadata.transcription);
  const reaction = asRecord(metadata.whatsappReaction);
  const status = transcription?.status;
  const voiceNote: TranscriptionState | null =
    metadata.voiceNote !== true
      ? null
      : status === 'done'
        ? { status: 'done' }
        : status === 'failed'
          ? {
              status: 'failed',
              error: typeof transcription?.error === 'string' ? transcription.error : null,
            }
          : { status: 'pending' };
  return {
    template:
      template && typeof template.name === 'string'
        ? {
            name: template.name,
            language: typeof template.language === 'string' ? template.language : null,
          }
        : null,
    voiceNote,
    reaction: reaction && typeof reaction.emoji === 'string' && reaction.emoji ? reaction.emoji : null,
  };
}

export interface ReadReceipt {
  kind: 'seen' | 'read';
  at: string;
}

export function readReceipt(
  message: Pick<MessageDto, 'seenAt' | 'firstOpenedAt'>,
  channelType: string | null | undefined,
): ReadReceipt | null {
  if (message.seenAt) return { kind: 'seen', at: message.seenAt };
  if (channelType === 'whatsapp' && message.firstOpenedAt) {
    return { kind: 'read', at: message.firstOpenedAt };
  }
  return null;
}
