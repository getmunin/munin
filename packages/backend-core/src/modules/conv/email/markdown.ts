import { Marked, type Tokens } from 'marked';
import type { QuotedPriorMessage } from './reply-history.ts';

const SAFE_LINK_PROTOCOL = /^(https?|mailto)$/i;
const SAFE_IMAGE_PROTOCOL = /^(https?|cid)$/i;

const emailMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      const escaped = escapeHtml(token.text);
      if (!token.block) return escaped;
      const trimmed = escaped.replace(/\n+$/, '');
      return trimmed ? `<p>${trimmed.replace(/\n/g, '<br>')}</p>\n` : '';
    },
    link(token: Tokens.Link): string {
      const inner = this.parser.parseInline(token.tokens);
      const href = safeUrl(token.href, SAFE_LINK_PROTOCOL);
      if (href === null) return inner;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<a href="${escapeHtml(href)}"${title}>${inner}</a>`;
    },
    image(token: Tokens.Image): string {
      const alt = escapeHtml(token.text);
      const src = safeUrl(token.href, SAFE_IMAGE_PROTOCOL);
      if (src === null) return alt;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<img src="${escapeHtml(src)}" alt="${alt}"${title}>`;
    },
  },
});

export function renderMarkdownToHtml(markdown: string): string {
  return emailMarked.parse(markdown, { async: false });
}

export function renderEmailHtml(
  bodyMarkdown: string,
  prior: QuotedPriorMessage[],
  limit = 3,
): string {
  const bodyHtml = renderMarkdownToHtml(bodyMarkdown);
  const quotedHtml = renderQuotedHistoryHtml(prior, limit);
  const inner = quotedHtml ? `${bodyHtml}\n${quotedHtml}` : bodyHtml;
  return [
    '<!doctype html>',
    '<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111;">',
    inner,
    '</body></html>',
  ].join('');
}

export function renderQuotedHistoryHtml(
  prior: QuotedPriorMessage[],
  limit = 3,
): string {
  if (prior.length === 0) return '';
  const slice = prior.slice(0, limit);
  let html = '';
  let closeCount = 0;
  for (const m of slice) {
    const when = escapeHtml(m.createdAt.toUTCString());
    const who = m.authorEmail
      ? `${escapeHtml(m.authorName)} &lt;${escapeHtml(m.authorEmail)}&gt;`
      : escapeHtml(m.authorName);
    const inner = renderMarkdownToHtml(m.body || '');
    html +=
      `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex;color:#555;">` +
      `<div>On ${when}, ${who} wrote:</div>${inner}`;
    closeCount += 1;
  }
  html += '</blockquote>'.repeat(closeCount);
  return html;
}

const NAMED_CHAR_REFS: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
  quest: '?',
  num: '#',
  lpar: '(',
  rpar: ')',
  period: '.',
};

function decodeCharRefs(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED_CHAR_REFS[ref.toLowerCase()] ?? whole;
  });
}

function safeUrl(raw: string, allowedProtocol: RegExp): string | null {
  let url: string;
  try {
    url = encodeURI(decodeCharRefs(raw)).replace(/%25/g, '%');
  } catch {
    return null;
  }
  const colon = url.indexOf(':');
  if (colon === -1) return url;
  const boundaries = ['/', '?', '#']
    .map((c) => url.indexOf(c))
    .filter((i) => i !== -1);
  if (boundaries.some((i) => i < colon)) return url;
  return allowedProtocol.test(url.slice(0, colon)) ? url : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
