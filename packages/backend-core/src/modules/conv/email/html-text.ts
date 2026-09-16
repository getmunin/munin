const BREAK = '\ue000';
const HARD_BREAK = '\ue001';
const MAX_CONSECUTIVE_NEWLINES = 2;

const SENTINELS = /[\ue000\ue001]/g;
const COMMENT = /<!--[\s\S]*?-->/g;
const DROPPED_ELEMENT = /<(script|style|head|title|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const BLOCK_TAG =
  /<\/?(?:p|div|section|article|aside|header|footer|main|nav|blockquote|pre|figure|figcaption|address|form|fieldset|hr|h[1-6]|ul|ol|li|dl|dt|dd|td|th|caption)\b[^>]*>/gi;
const DECLARATION = /<[!?][^>]*>/g;
const TAG = /<\/?[a-zA-Z][^>]*>/g;
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;
const GRAPHEME_JOINER = /\u034f/g;
const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g;
const BREAK_RUN = /[\ue000\ue001][ \ue000\ue001]*/g;
const HARD_BREAKS = /\ue001/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  zwnj: '',
  zwj: '',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  minus: '−',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  dagger: '†',
  deg: '°',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  aring: 'å',
  oslash: 'ø',
  aelig: 'æ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ntilde: 'ñ',
  Aring: 'Å',
  Oslash: 'Ø',
  AElig: 'Æ',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  Eacute: 'É',
};

export function htmlToText(html: string): string {
  if (!html) return '';
  let out = html.replace(SENTINELS, ' ').replace(COMMENT, ' ');
  for (;;) {
    const next = out.replace(DROPPED_ELEMENT, ' ');
    if (next === out) break;
    out = next;
  }
  out = out.replace(LINE_BREAK, HARD_BREAK).replace(BLOCK_TAG, BREAK);
  out = out.replace(DECLARATION, ' ').replace(TAG, ' ');
  out = decodeEntities(out).replace(INVISIBLE, '').replace(GRAPHEME_JOINER, '');
  out = out.replace(/\s+/g, ' ');
  out = out.replace(BREAK_RUN, (run) => '\n'.repeat(newlineCount(run)));
  return joinLines(out);
}

function newlineCount(run: string): number {
  const hard = run.match(HARD_BREAKS)?.length ?? 0;
  return Math.min(1 + hard, MAX_CONSECUTIVE_NEWLINES);
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole: string, ref: string) => {
    if (ref.startsWith('#')) return decodeNumericEntity(ref) ?? whole;
    return NAMED_ENTITIES[ref] ?? NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

function decodeNumericEntity(ref: string): string | null {
  const hex = ref[1] === 'x' || ref[1] === 'X';
  const code = Number.parseInt(hex ? ref.slice(2) : ref.slice(1), hex ? 16 : 10);
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  if (code === 0xe000 || code === 0xe001) return null;
  return String.fromCodePoint(code);
}

function joinLines(text: string): string {
  const out: string[] = [];
  let pendingBlank = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      pendingBlank = out.length > 0;
      continue;
    }
    if (pendingBlank) out.push('');
    pendingBlank = false;
    out.push(line);
  }
  return out.join('\n');
}
