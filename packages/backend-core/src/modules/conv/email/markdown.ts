import { marked } from 'marked';
import type { QuotedPriorMessage } from './reply-history.ts';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false });
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
