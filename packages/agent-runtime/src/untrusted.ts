export const RESERVED_FRAMING_TAGS = [
  'data',
  'tool_result',
  'company_context',
  'source_page',
] as const;

const FRAMING_TAG_RE = new RegExp(
  `<\\s*/?\\s*(?:${RESERVED_FRAMING_TAGS.join('|')})\\b[^>]*>`,
  'gi',
);

export function neutralizeFraming(text: string): string {
  return text.replace(FRAMING_TAG_RE, (match) => match.replace(/</g, '&lt;'));
}

export function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_.:-]/g, '');
  return cleaned.slice(0, 64) || 'unknown';
}

export function fenceUntrusted(
  tag: (typeof RESERVED_FRAMING_TAGS)[number],
  body: string,
  attributes: Record<string, string> = {},
): string {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${sanitizeAttributeValue(value)}"`)
    .join('');
  return `<${tag}${attrs}>\n${neutralizeFraming(body)}\n</${tag}>`;
}

export function sanitizeAttributeValue(value: string): string {
  return value.replace(/[<>"]/g, '').slice(0, 300);
}
