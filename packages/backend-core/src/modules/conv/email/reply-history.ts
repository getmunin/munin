/**
 * Email reply history helpers — strip quoted blocks from inbound mail so we
 * store only the *new* content, and build quoted blocks for outbound replies
 * so the recipient sees a normal mail-client style thread.
 *
 * Conservative by design: when in doubt, keep more (we'd rather show a stray
 * quote line than drop a real sentence).
 */

/** Standard "On … wrote:" markers across the languages our customers use. */
const QUOTE_HEADER_PATTERNS: RegExp[] = [
  /^on .+ wrote:\s*$/i,
  /^den .+ skrev .+:\s*$/i,
  /^le .+ a écrit\s*:\s*$/i,
  /^am .+ schrieb .+:\s*$/i,
  /^el .+ escribió\s*:\s*$/i,
  /^il .+ ha scritto\s*:\s*$/i,
  /^-{2,}\s*original\s+message\s*-{2,}\s*$/i,
  /^\s*forwarded\s+message\s*:?\s*$/i,
  /^_{5,}\s*$/,
];

/**
 * Strip the trailing quoted reply from a plain-text body. Cuts at the first
 * line that looks like a quote header (multi-language) or at a run of
 * `>`-prefixed lines that continues to the end of the message.
 */
export function stripQuotedReplyText(body: string): string {
  if (!body) return body;
  const lines = body.split(/\r?\n/);
  let cut = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (QUOTE_HEADER_PATTERNS.some((re) => re.test(line))) {
      cut = i;
      break;
    }
  }
  if (cut === lines.length) {
    let i = lines.length - 1;
    while (i >= 0) {
      const t = lines[i]!.trim();
      if (t === '' || t.startsWith('>')) {
        i -= 1;
        continue;
      }
      break;
    }
    if (i < lines.length - 3 && i < lines.length - 1) cut = i + 1;
  }
  return lines.slice(0, cut).join('\n').replace(/\s+$/g, '').trim();
}

/**
 * Strip common quoted-reply HTML containers. Targets Gmail's
 * `<blockquote class="gmail_quote">` / `<div class="gmail_quote">`, Outlook's
 * `divRplyFwdMsg` separator, and Apple Mail's `<blockquote type="cite">`.
 */
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
  /^sent from my (iphone|ipad|ipod|android|.+\bphone|.+\btablet)\b/i,
  /^sent from outlook( for ios| for android| mobile)?\b/i,
  /^get outlook for (ios|android)\b/i,
  /^sent via samsung\b/i,
  /^sendt fra (min )?(iphone|ipad|outlook|mobil|android)\b/i,
  /^envoyé de mon (iphone|ipad)\b/i,
  /^enviado desde mi (iphone|ipad)\b/i,
  /^verzonden vanaf mijn (iphone|ipad)\b/i,
  /^von meinem (iphone|ipad) gesendet\b/i,
];

/**
 * Strip an email signature off the end of an already-quote-stripped body.
 * Cuts at the first line that matches a known signature opener (RFC 3676
 * `-- `, mobile-client patterns across a few languages, or an underscore
 * separator). Always conservative — if cutting would leave the body empty
 * or near-empty, returns the input unchanged.
 *
 * Run AFTER `stripQuotedReplyText` so the openers aren't fighting the
 * quoted reply for the cut point.
 */
export function stripSignatureText(body: string): string {
  if (!body) return body;
  const lines = body.split(/\r?\n/);
  let cut = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (SIGNATURE_OPENERS.some((re) => re.test(line))) {
      cut = i;
      break;
    }
  }
  if (cut < 0) return body;
  const kept = lines.slice(0, cut);
  let nonEmpty = 0;
  for (const l of kept) if (l.trim() !== '') nonEmpty += 1;
  if (nonEmpty === 0) return body;
  return kept.join('\n').replace(/\s+$/g, '').trim();
}

/**
 * HTML signature strip — narrowly targets containers mail clients reliably
 * mark up as signatures. Gmail's `<div class="gmail_signature">` is the
 * canonical case. Outlook leaves no class hook so we don't try to guess.
 */
export function stripSignatureHtml(html: string | null): string | null {
  if (!html) return html;
  let out = html;
  out = out.replace(/<div[^>]*class="[^"]*gmail_signature[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  out = out.replace(/<div[^>]*data-smartmail="gmail_signature"[^>]*>[\s\S]*?<\/div>/gi, '');
  return out.replace(/\s+$/, '');
}

/** Prefix the subject with `Re: ` unless it already starts with one. */
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
