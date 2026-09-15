export const QUOTE_ATTRIBUTION_PATTERNS: RegExp[] = [
  /^on .+ wrote:\s*$/i,
  /^op .+ schreef .+:\s*$/i,
  /^den .+ skrev .+:\s*$/i,
  /^den .+ skreiv .+:\s*$/i,
  /^þann .+ skrifaði .+:\s*$/i,
  /^.+ kirjoitti:\s*$/i,
  /^le .+ a écrit\s*:\s*$/i,
  /^am .+ schrieb .+:\s*$/i,
  /^el .+ escribió\s*:\s*$/i,
  /^em .+ escreveu\s*:\s*$/i,
  /^il .+ ha scritto\s*:\s*$/i,
  /^w dniu .+ napisał(?:\(a\))?\s*:\s*$/i,
  /^.+ napsal(?:\(a\))?\s*:\s*$/i,
  /^.+ tarihinde .+ yazdı\s*:\s*$/i,
  /^.+ написал[аои]?\s*:\s*$/i,
  /^στις .+ έγραψε.*:\s*$/i,
  /^在 .+ 写道[：:]\s*$/,
  /^於 .+ 寫道[：:]\s*$/,
  /^.+ さんが.*書き(?:ました|込みました)[:：]?\s*$/,
  /^.+ 작성:\s*$/,
];

export const QUOTE_MARKER = /^(?:>\s?)+/;

const TIME_OF_DAY = /\d{1,2}[.:]\d{2}/;
const DATE_FIRST_QUOTE_VERB = /\b(?:skrev|skreiv|skrifaði|kirjoitti)\b/i;
const MAX_QUOTE_HEADER_LENGTH = 200;

const ANGLE_ADDRESS = /<([^<>@\s]+@[^<>@\s]+)>/;
const BARE_ADDRESS = /[^\s<>(),;:"]+@[^\s<>(),;:"]+\.[A-Za-z]{2,}/;

export function stripQuoteMarker(line: string): string {
  return line.replace(QUOTE_MARKER, '');
}

export function quoteDepth(line: string): number {
  const marker = QUOTE_MARKER.exec(line);
  if (!marker) return 0;
  return (marker[0].match(/>/g) ?? []).length;
}

export function isAttributionText(text: string): boolean {
  if (!text || text.length > MAX_QUOTE_HEADER_LENGTH) return false;
  if (QUOTE_ATTRIBUTION_PATTERNS.some((re) => re.test(text))) return true;
  return text.endsWith(':') && TIME_OF_DAY.test(text) && DATE_FIRST_QUOTE_VERB.test(text);
}

export function isAttributionLine(line: string): boolean {
  return isAttributionText(stripQuoteMarker(line).trim());
}

export function senderFromAttribution(text: string): string | null {
  const angle = ANGLE_ADDRESS.exec(text);
  if (angle) {
    const address = angle[1]!;
    const name = displayNameBefore(text.slice(0, angle.index));
    return name ? `${name} <${address}>` : address;
  }
  const bare = BARE_ADDRESS.exec(text);
  return bare ? bare[0] : null;
}

const ATTRIBUTION_LEAD_WORDS = new Set([
  'am',
  'pm',
  'wrote',
  'schreef',
  'skrev',
  'skreiv',
  'skrifaði',
  'kirjoitti',
  'schrieb',
  'escribió',
  'escreveu',
  'napisał',
  'napisała',
  'napsal',
  'napsala',
  'yazdı',
  'написал',
  'написала',
  'έγραψε',
]);

function displayNameBefore(prefix: string): string | null {
  const tokens = prefix.trim().split(/\s+/).filter((t) => t.length > 0);
  let start = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (/\d/.test(tokens[i]!)) start = i + 1;
  }
  while (start < tokens.length) {
    const word = tokens[start]!.replace(/[.,:;]+$/, '').toLowerCase();
    if (!ATTRIBUTION_LEAD_WORDS.has(word)) break;
    start += 1;
  }
  const candidate = tokens
    .slice(start)
    .join(' ')
    .replace(/[,:;]+$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!candidate || candidate.length > 120) return null;
  if (BARE_ADDRESS.test(candidate)) return null;
  return candidate;
}
