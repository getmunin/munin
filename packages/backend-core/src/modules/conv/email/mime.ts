import { randomUUID } from 'node:crypto';

export interface BuildOutboundInput {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  messageIdDomain: string;
  inReplyTo?: string;
  references?: string[];
  trackerUrl?: string;
}

export interface BuiltMessage {
  raw: string;
  messageId: string;
}

export function buildOutbound(input: BuildOutboundInput): BuiltMessage {
  const localPart = randomUUID();
  const messageId = `${localPart}@${stripDomain(input.messageIdDomain)}`;
  const headers: [string, string][] = [
    ['From', input.from],
    ['To', input.to],
    ['Subject', encodeHeaderValue(input.subject)],
    ['Date', new Date().toUTCString()],
    ['Message-ID', `<${messageId}>`],
    ['MIME-Version', '1.0'],
  ];
  if (input.replyTo) headers.push(['Reply-To', input.replyTo]);
  if (input.inReplyTo) headers.push(['In-Reply-To', `<${input.inReplyTo}>`]);
  if (input.references?.length) {
    headers.push(['References', input.references.map((r) => `<${r}>`).join(' ')]);
  }

  const text = input.text;
  const html = input.html;
  let body: string;
  if (html) {
    const boundary = `munin-boundary-${randomUUID()}`;
    headers.push(['Content-Type', `multipart/alternative; boundary="${boundary}"`]);
    const htmlWithTracker = input.trackerUrl
      ? injectTrackingPixel(html, input.trackerUrl)
      : html;
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      htmlWithTracker,
      '',
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    headers.push(['Content-Type', 'text/plain; charset="utf-8"']);
    headers.push(['Content-Transfer-Encoding', '7bit']);
    body = text;
  }

  const headerLines = headers.map(([k, v]) => `${k}: ${v}`).join('\r\n');
  return { raw: `${headerLines}\r\n\r\n${body}`, messageId };
}

function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return `=?utf-8?B?${b64}?=`;
}

function stripDomain(host: string): string {
  return host.replace(/^.*@/, '').replace(/[\s<>]/g, '');
}

function injectTrackingPixel(html: string, url: string): string {
  const safeUrl = url.replace(/"/g, '&quot;');
  const pixel = `<img src="${safeUrl}" alt="" width="1" height="1" style="display:none;border:0" />`;
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${pixel}</body>`);
  }
  return `${html}${pixel}`;
}

export function stripMessageIdBrackets(raw: string): string {
  return raw.trim().replace(/^<|>$/g, '');
}

export function parseMessageIdHeader(raw: string | undefined): string[] {
  if (!raw) return [];
  const matches = raw.match(/<[^<>]+>/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}

export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(?:\s*(?:Re|RE|Fwd|FW|FWD|Sv|VS|Aw|AW|Antw|RIF|R)\s*:\s*)+/i, '')
    .trim();
}

export function extractPlusAddressedConvId(
  addresses: readonly string[],
  replyDomain: string,
): string | null {
  const dom = replyDomain.replace(/^@/, '').toLowerCase();
  for (const raw of addresses) {
    const addr = extractEmail(raw)?.toLowerCase();
    if (!addr) continue;
    const at = addr.indexOf('@');
    if (at < 0) continue;
    const local = addr.slice(0, at);
    const host = addr.slice(at + 1);
    if (host !== dom) continue;
    const m = local.match(/(?:^|\+)conv-([A-Za-z0-9_-]+)$/);
    if (m) return m[1] ?? null;
  }
  return null;
}

function extractEmail(raw: string): string | null {
  const angle = raw.match(/<([^<>]+@[^<>]+)>/);
  if (angle) return angle[1] ?? null;
  const bare = raw.match(/[^\s,;<>]+@[^\s,;<>]+/);
  return bare?.[0] ?? null;
}
