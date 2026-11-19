export interface MergeValues {
  subject?: string | null;
  preheader?: string | null;
  orgName?: string | null;
  name?: string | null;
  unsubscribeUrl?: string | null;
  customFields?: Record<string, unknown> | null;
}

export const MERGE_PLACEHOLDER = /\{\{\s*([^{}|\s]+)\s*(?:\|([^{}]*))?\}\}/g;

export const CONTENT_PLACEHOLDERS = ['subject', 'org_name', 'name'] as const;

export const CUSTOM_FIELD_PLACEHOLDER_PREFIX = 'contact.custom_fields.';

const CUSTOM_FIELD_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const URL_ATTRIBUTE = /(\s(?:href|src)\s*=\s*)(["'])([\s\S]*?)\2/gi;

export interface ContentPlaceholder {
  name: string;
  fallback: string | undefined;
  customFieldKey: string | null;
  index: number;
}

export function listContentPlaceholders(text: string): ContentPlaceholder[] {
  return [...text.matchAll(MERGE_PLACEHOLDER)].map((match) => ({
    name: match[1]!,
    fallback: match[2],
    customFieldKey: customFieldKey(match[1]!),
    index: match.index,
  }));
}

export function contentPlaceholderProblem(placeholder: ContentPlaceholder): string | null {
  const { name, fallback, customFieldKey: key } = placeholder;
  if (name.startsWith(CUSTOM_FIELD_PLACEHOLDER_PREFIX)) {
    return key === null
      ? `{{${name}}} is not a valid custom field; field keys use letters, digits, _ and -`
      : null;
  }
  if (!(CONTENT_PLACEHOLDERS as readonly string[]).includes(name)) {
    return `content may not use {{${name}}}; content placeholders are ${CONTENT_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')} and {{${CUSTOM_FIELD_PLACEHOLDER_PREFIX}<field>|fallback}}`;
  }
  if (fallback !== undefined && name !== 'name') {
    return `only {{name}} and {{${CUSTOM_FIELD_PLACEHOLDER_PREFIX}<field>}} take a fallback; {{${name}|…}} is not supported`;
  }
  return null;
}

export function resolvePlaceholder(rawName: string, fallback: string | undefined, values: MergeValues): string {
  const value = placeholderValue(rawName, values);
  return value?.trim() ? value : (fallback ?? '').trim();
}

export function personalizeText(text: string, values: MergeValues): string {
  return text.replace(MERGE_PLACEHOLDER, (_match, rawName: string, fallback?: string) =>
    resolvePlaceholder(rawName, fallback, values),
  );
}

export function personalizeLine(text: string, values: MergeValues): string {
  return personalizeText(text, values).replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

export function blankCustomFieldsInUrls(html: string): string {
  return html.replace(URL_ATTRIBUTE, (_whole, lead: string, quote: string, url: string) => {
    const cleaned = url.replace(MERGE_PLACEHOLDER, (match, rawName: string) =>
      customFieldKey(rawName) === null ? match : '',
    );
    return `${lead}${quote}${cleaned}${quote}`;
  });
}

function placeholderValue(name: string, values: MergeValues): string | null | undefined {
  switch (name) {
    case 'unsubscribe_url':
      return values.unsubscribeUrl;
    case 'preheader':
      return values.preheader;
    case 'subject':
      return values.subject;
    case 'org_name':
      return values.orgName;
    case 'name':
      return values.name;
    default: {
      const key = customFieldKey(name);
      if (key === null || !values.customFields || !Object.hasOwn(values.customFields, key)) return '';
      return customFieldValue(values.customFields[key]);
    }
  }
}

function customFieldKey(name: string): string | null {
  if (!name.startsWith(CUSTOM_FIELD_PLACEHOLDER_PREFIX)) return null;
  const key = name.slice(CUSTOM_FIELD_PLACEHOLDER_PREFIX.length);
  return CUSTOM_FIELD_KEY.test(key) ? key : null;
}

function customFieldValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return '';
}

export interface UnfilledPlaceholder {
  placeholder: string;
  fallback: string | null;
}

export interface MergePreview {
  subject: string | null;
  body: string;
  unfilled: UnfilledPlaceholder[];
}

export interface JourneyMergeContact {
  name: string | null;
  customFields: Record<string, unknown> | null;
}

export function previewJourneyMerge(
  message: { channel: string; subject: string | null; body: string },
  contact: JourneyMergeContact,
  orgName: string | null,
): MergePreview | null {
  if (message.channel === 'voice') return null;
  const email = message.channel === 'email';
  const subjectText = email ? message.subject : null;
  const found = [
    ...(subjectText ? listContentPlaceholders(subjectText) : []),
    ...listContentPlaceholders(message.body),
  ];
  if (found.length === 0) return null;
  const values: MergeValues = email
    ? { name: contact.name, orgName, customFields: contact.customFields }
    : { name: contact.name?.trim() ?? null, customFields: contact.customFields };
  const subject = subjectText === null ? null : personalizeLine(subjectText, values);
  const bodyValues = email ? { ...values, subject } : values;
  const unfilled = new Map<string, UnfilledPlaceholder>();
  for (const { name, fallback } of found) {
    if (unfilled.has(name) || placeholderValue(name, bodyValues)?.trim()) continue;
    unfilled.set(name, { placeholder: name, fallback: fallback?.trim() || null });
  }
  return {
    subject,
    body: personalizeText(message.body, bodyValues),
    unfilled: [...unfilled.values()],
  };
}
