import { randomUUID } from 'node:crypto';

export interface OutboundAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  inline?: boolean;
  contentId?: string | null;
}

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
  attachments?: readonly OutboundAttachment[];
}

export interface BuiltMessage {
  raw: string;
  messageId: string;
}

type MimePart =
  | {
      kind: 'leaf';
      contentType: string;
      encoding: string;
      disposition?: string;
      contentId?: string;
      body: string;
    }
  | { kind: 'multipart'; subtype: string; params?: string; parts: MimePart[] };

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

  const html = input.html
    ? input.trackerUrl
      ? injectTrackingPixel(input.html, input.trackerUrl)
      : input.html
    : undefined;

  const textPart: MimePart = {
    kind: 'leaf',
    contentType: 'text/plain; charset="utf-8"',
    encoding: '7bit',
    body: input.text,
  };
  let root: MimePart = html
    ? {
        kind: 'multipart',
        subtype: 'alternative',
        parts: [
          textPart,
          {
            kind: 'leaf',
            contentType: 'text/html; charset="utf-8"',
            encoding: '7bit',
            body: html,
          },
        ],
      }
    : textPart;

  const attachments = input.attachments ?? [];
  const inlineParts = attachments.filter((a) => isReferencedInline(a, html));
  const fileParts = attachments.filter((a) => !isReferencedInline(a, html));

  if (inlineParts.length > 0) {
    root = {
      kind: 'multipart',
      subtype: 'related',
      params: 'type="text/html"',
      parts: [root, ...inlineParts.map((a) => attachmentPart(a, true))],
    };
  }
  if (fileParts.length > 0) {
    root = {
      kind: 'multipart',
      subtype: 'mixed',
      parts: [root, ...fileParts.map((a) => attachmentPart(a, false))],
    };
  }

  const rendered = renderPart(root);
  for (const header of rendered.headers) headers.push(header);
  const headerLines = headers.map(([k, v]) => `${k}: ${v}`).join('\r\n');
  return { raw: `${headerLines}\r\n\r\n${rendered.body}`, messageId };
}

function isReferencedInline(part: OutboundAttachment, html: string | undefined): boolean {
  const cid = bareContentId(part.contentId);
  if (!part.inline || !cid || !html) return false;
  return html.toLowerCase().includes(`cid:${cid.toLowerCase()}`);
}

function bareContentId(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/^</, '').replace(/>$/, '').trim();
  return trimmed || null;
}

function attachmentPart(part: OutboundAttachment, inline: boolean): MimePart {
  const cid = bareContentId(part.contentId);
  const nameParam = asciiFilenameParam(part.filename);
  return {
    kind: 'leaf',
    contentType: [sanitizeHeaderToken(part.contentType) || 'application/octet-stream', nameParam]
      .filter(Boolean)
      .join('; '),
    encoding: 'base64',
    disposition: `${inline ? 'inline' : 'attachment'}; ${filenameParam(part.filename)}`,
    ...(inline && cid ? { contentId: `<${sanitizeHeaderToken(cid)}>` } : {}),
    body: wrapBase64(part.content.toString('base64')),
  };
}

function renderPart(part: MimePart): { headers: [string, string][]; body: string } {
  if (part.kind === 'leaf') {
    const headers: [string, string][] = [
      ['Content-Type', part.contentType],
      ['Content-Transfer-Encoding', part.encoding],
    ];
    if (part.disposition) headers.push(['Content-Disposition', part.disposition]);
    if (part.contentId) headers.push(['Content-ID', part.contentId]);
    return { headers, body: part.body };
  }

  const boundary = `munin-boundary-${randomUUID()}`;
  const contentType = [`multipart/${part.subtype}`, part.params, `boundary="${boundary}"`]
    .filter(Boolean)
    .join('; ');
  const chunks = part.parts.map((child) => {
    const rendered = renderPart(child);
    const childHeaders = rendered.headers.map(([k, v]) => `${k}: ${v}`).join('\r\n');
    return `--${boundary}\r\n${childHeaders}\r\n\r\n${rendered.body}`;
  });
  return {
    headers: [['Content-Type', contentType]],
    body: `${chunks.join('\r\n')}\r\n--${boundary}--`,
  };
}

function wrapBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

function sanitizeHeaderToken(value: string): string {
  return value.replace(/[\r\n";]/g, '').trim();
}

function isAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

function filenameParam(name: string): string {
  const clean = sanitizeHeaderToken(name) || 'attachment';
  return isAscii(clean) ? `filename="${clean}"` : `filename*=utf-8''${encodeURIComponent(clean)}`;
}

function asciiFilenameParam(name: string): string {
  const clean = sanitizeHeaderToken(name);
  return clean && isAscii(clean) ? `name="${clean}"` : '';
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
