import { schema, type Db } from '@getmunin/db';
import { and, desc, eq, sql } from 'drizzle-orm';

const QUOTE_HEADER_PATTERNS: RegExp[] = [
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
  /^-{2,}\s*original\s+message\s*-{2,}\s*$/i,
  /^-{2,}\s*opprinnelig\s+melding\s*-{2,}\s*$/i,
  /^-{2,}\s*original\s+meddelelse\s*-{2,}\s*$/i,
  /^-{2,}\s*ursprüngliche\s+nachricht\s*-{2,}\s*$/i,
  /^-{2,}\s*mensaje\s+original\s*-{2,}\s*$/i,
  /^-{2,}\s*message\s+original\s*-{2,}\s*$/i,
  /^-{2,}\s*messaggio\s+originale\s*-{2,}\s*$/i,
  /^\s*forwarded\s+message\s*:?\s*$/i,
  /^_{5,}\s*$/,
];

const QUOTE_MARKER = /^(?:>\s?)+/;
const WRAPPED_ADDRESS_TAIL = /^>\s*:$/;
const TIME_OF_DAY = /\d{1,2}[.:]\d{2}/;
const DATE_FIRST_QUOTE_VERB = /\b(?:skrev|skreiv|skrifaði|kirjoitti)\b/i;
const MAX_QUOTE_HEADER_LENGTH = 200;

export function stripQuotedReplyText(body: string): string {
  if (!body) return body;
  const lines = unwrapAttributionBreaks(body.split(/\r?\n/));
  const cut =
    findQuoteHeaderCut(lines) ?? findTrailingQuoteCut(lines) ?? findQuoteCutAboveSignature(lines);
  if (cut === null) return lines.join('\n').replace(/\s+$/g, '').trim();
  return joinAroundQuote(lines, cut);
}

function hasUnclosedAngle(line: string): boolean {
  const open = line.lastIndexOf('<');
  return open >= 0 && line.indexOf('>', open) < 0;
}

function unwrapAttributionBreaks(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (next !== undefined && hasUnclosedAngle(line) && WRAPPED_ADDRESS_TAIL.test(next.trim())) {
      out.push(`${line}${next.trim()}`);
      i += 1;
      continue;
    }
    out.push(line);
  }
  return out;
}

function isQuoteHeaderLine(line: string): boolean {
  const text = line.replace(QUOTE_MARKER, '').trim();
  if (!text || text.length > MAX_QUOTE_HEADER_LENGTH) return false;
  if (QUOTE_HEADER_PATTERNS.some((re) => re.test(text))) return true;
  return text.endsWith(':') && TIME_OF_DAY.test(text) && DATE_FIRST_QUOTE_VERB.test(text);
}

function findQuoteHeaderCut(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (!isQuoteHeaderLine(lines[i]!)) continue;
    if (!lines.slice(0, i).some((l) => l.trim() !== '')) return null;
    return i;
  }
  return null;
}

function findTrailingQuoteCut(lines: string[]): number | null {
  let i = lines.length - 1;
  while (i >= 0) {
    const t = lines[i]!.trim();
    if (t === '' || t.startsWith('>')) {
      i -= 1;
      continue;
    }
    break;
  }
  if (i < lines.length - 3 && i < lines.length - 1) return i + 1;
  return null;
}

function findQuoteCutAboveSignature(lines: string[]): number | null {
  const opener = findSignatureOpener(lines);
  if (opener === null) return null;
  return findTrailingQuoteCut(lines.slice(0, opener));
}

function joinAroundQuote(lines: string[], cut: number): string {
  const kept = lines.slice(0, cut).join('\n').replace(/\s+$/g, '').trim();
  const below = lines.slice(cut);
  const opener = findSignatureOpener(below);
  if (opener === null) return kept;
  const signature = below.slice(opener);
  if (signature.some((l) => l.trimStart().startsWith('>'))) return kept;
  const text = signature.join('\n').replace(/\s+$/g, '');
  return text ? `${kept}\n\n${text}` : kept;
}

export function stripQuotedReplyHtml(html: string | null): string | null {
  if (!html) return html;
  let out = html;
  out = out.replace(/<blockquote[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>[\s\S]*?<\/blockquote>/gi, '');
  out = out.replace(/<div[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  out = out.replace(/<blockquote[^>]*type="cite"[^>]*>[\s\S]*?<\/blockquote>/gi, '');
  out = out.replace(/<div[^>]*id="divRplyFwdMsg"[^>]*>[\s\S]*$/i, '');
  out = out.replace(/<hr[^>]*id="[^"]*stopSpelling[^"]*"[^>]*>[\s\S]*$/i, '');
  return out.replace(/\s+$/, '');
}

const SIGNATURE_OPENERS: RegExp[] = [
  /^--\s?$/,
  /^_{5,}$/,
  /^={5,}$/,
  /^sent from my (iphone|ipad|ipod|android|.+\bphone|.+\btablet)\b/i,
  /^sent from outlook( for ios| for android| mobile)?\b/i,
  /^get outlook for (ios|android)\b/i,
  /^sent via samsung\b/i,
  /^sendt fra (min )?(iphone|ipad|outlook|mobil|android)\b/i,
  /^skickat från min (iphone|ipad|outlook|mobil|android)\b/i,
  /^skicka(t|d) från outlook( för ios| för android| mobile)?\b/i,
  /^hae outlook (iossille|androidille)\b/i,
  /^lähetetty (iphonesta|ipadista|outlookista|androidista)\b/i,
  /^sent (úr|frá) (iphone|ipad)\b/i,
  /^envoyé de mon (iphone|ipad)\b/i,
  /^enviado desde mi (iphone|ipad)\b/i,
  /^enviado do meu (iphone|ipad)\b/i,
  /^inviato da(l mio)? (iphone|ipad)\b/i,
  /^verzonden vanaf mijn (iphone|ipad)\b/i,
  /^von meinem (iphone|ipad) gesendet\b/i,
  /^wysłane z mojego (iphone|ipad)\b/i,
  /^odesláno z (mého|méno) (iphonu|ipadu)\b/i,
  /^iphone'?umdan gönderildi/i,
  /^outlook for (ios|android)'?(dan|den) gönderildi/i,
  /^отправлено (с|из) (iphone|ipad)/i,
  /^发自我的(iphone|ipad)/i,
  /^自(iphone|ipad)发送/i,
  /^自我的(iphone|ipad)/i,
  /^iphoneから送信/i,
  /^내 (iphone|ipad)에서 보냄/i,
];

export function stripSignatureText(body: string): string {
  return splitSignatureText(body).clean;
}

function findSignatureOpener(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (SIGNATURE_OPENERS.some((re) => re.test(lines[i]!.trim()))) return i;
  }
  return null;
}

export function splitSignatureText(body: string): { clean: string; signature: string | null } {
  if (!body) return { clean: body, signature: null };
  const lines = body.split(/\r?\n/);
  const cut = findSignatureOpener(lines);
  if (cut === null) return { clean: body, signature: null };
  const kept = lines.slice(0, cut);
  let nonEmpty = 0;
  for (const l of kept) if (l.trim() !== '') nonEmpty += 1;
  if (nonEmpty === 0) return { clean: body, signature: null };
  const clean = kept.join('\n').replace(/\s+$/g, '').trim();
  const signature = lines.slice(cut).join('\n').replace(/^\s+|\s+$/g, '');
  return { clean, signature: signature.length > 0 ? signature : null };
}

export function stripSignatureHtml(html: string | null): string | null {
  if (!html) return html;
  let out = html;
  out = out.replace(/<div[^>]*class="[^"]*gmail_signature[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  out = out.replace(/<div[^>]*data-smartmail="gmail_signature"[^>]*>[\s\S]*?<\/div>/gi, '');
  return out.replace(/\s+$/, '');
}

const SIGNATURE_INFO_HINTS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(^|\s)\+?\d[\d\s().-]{6,}\d(\s|$)/,
  /(https?:\/\/|www\.)\S+\.[a-z]{2,}/i,
  /^\s*(mobile|phone|tel|email|e-mail|web|www)\s*[:.]/i,
];
const SIGNATURE_DETECT_MAX_LINES = 30;

function signatureHintCount(lines: string[]): number {
  let n = 0;
  for (const re of SIGNATURE_INFO_HINTS) {
    if (lines.some((l) => re.test(l))) n += 1;
  }
  return n;
}

export function countSignatureHints(block: string): number {
  if (!block) return 0;
  return signatureHintCount(block.split(/\r?\n/));
}

function normalizeForSplit(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function isTrailingSignatureSplit(
  original: string,
  body: string,
  signature: string,
): boolean {
  const o = normalizeForSplit(original);
  const b = normalizeForSplit(body);
  const s = normalizeForSplit(signature);
  if (!o || !s) return false;
  if (b && !o.startsWith(b)) return false;
  return o.endsWith(s);
}

export function detectSignatureBlock(body: string, html: string | null = null): string | null {
  const fromHtml = detectSignatureBlockFromHtml(html);
  if (fromHtml) return fromHtml;
  return detectSignatureBlockFromText(body);
}

function detectSignatureBlockFromText(body: string): string | null {
  if (!body) return null;
  const lines = body.split(/\r?\n/);
  let end = lines.length - 1;
  while (end >= 0 && lines[end]!.trim() === '') end -= 1;
  if (end < 0) return null;
  let start = end;
  while (start > 0 && lines[start - 1]!.trim() !== '') start -= 1;
  if (start === 0) return null;
  if (end - start + 1 > SIGNATURE_DETECT_MAX_LINES) return null;
  const block = lines.slice(start, end + 1);
  if (signatureHintCount(block) === 0) return null;
  const keptHasContent = lines.slice(0, start).some((l) => l.trim().length > 0);
  if (!keptHasContent) return null;
  return block.join('\n').trim() || null;
}

function detectSignatureBlockFromHtml(html: string | null): string | null {
  if (!html) return null;
  const openRe =
    /<div[^>]*(?:class="[^"]*gmail_signature[^"]*"|data-smartmail="gmail_signature")[^>]*>/i;
  const openMatch = openRe.exec(html);
  if (!openMatch) return null;
  const innerStart = openMatch.index + openMatch[0].length;
  let depth = 1;
  let i = innerStart;
  const tagRe = /<(\/?)div\b[^>]*>/gi;
  tagRe.lastIndex = innerStart;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[1] === '/') {
      depth -= 1;
      if (depth === 0) {
        i = m.index;
        break;
      }
    } else {
      depth += 1;
    }
  }
  if (depth !== 0) return null;
  const inner = html.slice(innerStart, i);
  const text = inner
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
  return text.length > 0 ? text : null;
}

export function ensureReSubject(subject: string | null | undefined): string {
  const s = (subject ?? '').trim();
  if (!s) return 'Re: (no subject)';
  if (/^re\s*:/i.test(s)) return s;
  return `Re: ${s}`;
}

export interface QuotedPriorMessage {
  authorName: string;
  authorEmail: string | null;
  createdAt: Date;
  body: string;
}

export async function loadPriorMessagesForQuote(
  db: Db,
  args: {
    conversationId: string;
    excludeMessageId: string;
    contactName: string | null;
    contactEmail: string | null;
    channelFromName: string;
    limit: number;
  },
): Promise<QuotedPriorMessage[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const rows = await tx
      .select({
        authorType: schema.convMessages.authorType,
        body: schema.convMessages.body,
        createdAt: schema.convMessages.createdAt,
      })
      .from(schema.convMessages)
      .where(
        and(
          eq(schema.convMessages.conversationId, args.conversationId),
          eq(schema.convMessages.internal, false),
          sql`${schema.convMessages.id} <> ${args.excludeMessageId}`,
        ),
      )
      .orderBy(desc(schema.convMessages.createdAt))
      .limit(args.limit);
    return rows.map((r) => {
      const isContact = r.authorType === 'end_user';
      return {
        authorName: isContact ? args.contactName ?? 'User' : args.channelFromName,
        authorEmail: isContact ? args.contactEmail : null,
        createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
        body: r.body,
      };
    });
  });
}

export function formatQuotedHistory(prior: QuotedPriorMessage[], limit = 3): string {
  if (prior.length === 0) return '';
  const slice = prior.slice(0, limit);
  const lines: string[] = [];
  slice.forEach((m, i) => {
    const headerPrefix = '> '.repeat(i);
    const bodyPrefix = '> '.repeat(i + 1);
    const when = m.createdAt.toUTCString();
    const who = m.authorEmail ? `${m.authorName} <${m.authorEmail}>` : m.authorName;
    if (i > 0) lines.push(headerPrefix.trimEnd());
    lines.push(`${headerPrefix}On ${when}, ${who} wrote:`);
    for (const raw of (m.body || '').split(/\r?\n/)) {
      lines.push(raw ? `${bodyPrefix}${raw}` : bodyPrefix.trimEnd());
    }
  });
  return lines.join('\n');
}
