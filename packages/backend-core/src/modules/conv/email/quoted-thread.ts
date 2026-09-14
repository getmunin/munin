import { normalizeFlattenedWhitespace } from './inbound-body-limits.ts';
import { FORWARD_MARKERS } from './forwarded-sender.ts';

export interface QuotedTurn {
  from: string | null;
  to: string | null;
  date: string | null;
  subject: string | null;
  body: string;
}

export interface QuotedHeaderBlock {
  start: number;
  end: number;
  from: string;
  to: string | null;
  date: string | null;
  subject: string | null;
}

const FROM_LABELS = [
  'from',
  'fra',
  'från',
  'frá',
  'von',
  'de',
  'da',
  'van',
  'od',
  'lähettäjä',
  'mittente',
  'remitente',
  'nadawca',
  'odesílatel',
  'kimden',
  'gönderen',
  'от',
  'отправитель',
  'από',
];

const TO_LABELS = [
  'to',
  'til',
  'till',
  'an',
  'à',
  'a',
  'para',
  'aan',
  'do',
  'komu',
  'vastaanottaja',
  'destinatario',
  'destinatário',
  'adresat',
  'kime',
  'alıcı',
  'кому',
  'προς',
];

const DATE_LABELS = [
  'date',
  'sent',
  'dato',
  'sendt',
  'datum',
  'skickat',
  'gesendet',
  'envoyé',
  'enviado',
  'inviato',
  'verzonden',
  'wysłano',
  'odesláno',
  'päivämäärä',
  'lähetetty',
  'data',
  'tarih',
  'дата',
  'отправлено',
  'ημερομηνία',
];

const SUBJECT_LABELS = [
  'subject',
  'emne',
  'ämne',
  'efni',
  'betreff',
  'objet',
  'asunto',
  'assunto',
  'oggetto',
  'onderwerp',
  'temat',
  'předmět',
  'aihe',
  'konu',
  'тема',
  'θέμα',
];

const CC_LABELS = ['cc', 'kopi', 'kopia', 'kopie', 'copia', 'копия'];

const MAX_HEADER_LINE_CHARS = 400;
const MAX_HEADER_BLOCK_SCAN = 6;
const MIN_COMPANION_LABELS = 2;
const MAX_QUOTED_TURNS = 20;
const MIN_PARTIAL_MATCH_CHARS = 40;
const MAX_QUOTED_TURN_CHARS = 4_000;

function buildLabelPattern(labels: string[]): RegExp {
  return new RegExp(`^(?:${labels.join('|')})\\s*:\\s*(.*)$`, 'i');
}

const FROM_PATTERN = buildLabelPattern(FROM_LABELS);
const TO_PATTERN = buildLabelPattern(TO_LABELS);
const DATE_PATTERN = buildLabelPattern(DATE_LABELS);
const SUBJECT_PATTERN = buildLabelPattern(SUBJECT_LABELS);
const CC_PATTERN = buildLabelPattern(CC_LABELS);

function matchLabel(line: string, pattern: RegExp): string | null {
  const text = line.trim();
  if (!text || text.length > MAX_HEADER_LINE_CHARS) return null;
  const match = pattern.exec(text);
  if (!match) return null;
  const value = (match[1] ?? '').trim();
  return value.length > 0 ? value : null;
}

function readHeaderBlock(lines: string[], index: number): QuotedHeaderBlock | null {
  const from = matchLabel(lines[index]!, FROM_PATTERN);
  if (from === null) return null;
  let to: string | null = null;
  let date: string | null = null;
  let subject: string | null = null;
  let companions = 0;
  let end = index + 1;
  const limit = Math.min(index + 1 + MAX_HEADER_BLOCK_SCAN, lines.length);
  for (let i = index + 1; i < limit; i += 1) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const nextTo = matchLabel(line, TO_PATTERN);
    const nextDate = matchLabel(line, DATE_PATTERN);
    const nextSubject = matchLabel(line, SUBJECT_PATTERN);
    const nextCc = matchLabel(line, CC_PATTERN);
    if (nextTo === null && nextDate === null && nextSubject === null && nextCc === null) break;
    if (nextTo !== null && to === null) to = nextTo;
    if (nextDate !== null && date === null) date = nextDate;
    if (nextSubject !== null && subject === null) subject = nextSubject;
    companions += 1;
    end = i + 1;
  }
  if (companions < MIN_COMPANION_LABELS) return null;
  return { start: index, end, from, to, date, subject };
}

export function findHeaderBlocks(lines: string[]): QuotedHeaderBlock[] {
  const blocks: QuotedHeaderBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const block = readHeaderBlock(lines, i);
    if (block === null) {
      i += 1;
      continue;
    }
    blocks.push(block);
    i = block.end;
  }
  return blocks;
}

function isForwardIntroduced(lines: string[], start: number): boolean {
  for (let i = start - 1; i >= 0; i -= 1) {
    if (lines[i]!.trim() === '') continue;
    return FORWARD_MARKERS.some((re) => re.test(lines[i]!));
  }
  return false;
}

function findQuotedHistoryStart(lines: string[], blocks: QuotedHeaderBlock[]): number | null {
  for (let i = 0; i < blocks.length; i += 1) {
    if (isForwardIntroduced(lines, blocks[i]!.start)) continue;
    if (!lines.slice(0, blocks[i]!.start).some((l) => l.trim() !== '')) return null;
    return i;
  }
  return null;
}

export function findHeaderBlockQuoteCut(lines: string[]): number | null {
  const blocks = findHeaderBlocks(lines);
  const start = findQuotedHistoryStart(lines, blocks);
  return start === null ? null : blocks[start]!.start;
}

function normalizeQuotedBody(lines: string[]): string {
  const joined = normalizeFlattenedWhitespace(lines.join('\n'));
  if (joined.length <= MAX_QUOTED_TURN_CHARS) return joined;
  return `${joined.slice(0, MAX_QUOTED_TURN_CHARS)}…`;
}

export function parseQuotedThread(body: string): QuotedTurn[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const blocks = findHeaderBlocks(lines);
  const start = findQuotedHistoryStart(lines, blocks);
  if (start === null) return [];
  const turns: QuotedTurn[] = [];
  for (let i = start; i < blocks.length && turns.length < MAX_QUOTED_TURNS; i += 1) {
    const block = blocks[i]!;
    const nextStart = blocks[i + 1]?.start ?? lines.length;
    turns.push({
      from: block.from,
      to: block.to,
      date: block.date,
      subject: block.subject,
      body: normalizeQuotedBody(lines.slice(block.end, nextStart)),
    });
  }
  return turns;
}

function comparableBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim().toLowerCase();
}

function sameText(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_PARTIAL_MATCH_CHARS && longer.includes(shorter);
}

export function dropRecordedTurns(turns: QuotedTurn[], recordedBodies: string[]): QuotedTurn[] {
  const recorded = recordedBodies.map(comparableBody).filter((b) => b.length > 0);
  if (recorded.length === 0) return turns;
  return turns.filter((turn) => {
    const body = comparableBody(turn.body);
    return !recorded.some((existing) => sameText(existing, body));
  });
}
