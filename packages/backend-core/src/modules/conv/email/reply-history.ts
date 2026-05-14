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

export function splitSignatureText(body: string): { clean: string; signature: string | null } {
  if (!body) return { clean: body, signature: null };
  const lines = body.split(/\r?\n/);
  let cut = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (SIGNATURE_OPENERS.some((re) => re.test(line))) {
      cut = i;
      break;
    }
  }
  if (cut < 0) return { clean: body, signature: null };
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
