import { randomUUID } from 'node:crypto';

/**
 * Outbound MIME assembly. Builds an RFC-822 message that nodemailer can
 * send raw (`raw:` envelope option) and that downstream MTAs / our own
 * inbound worker can thread on `Message-ID` / `In-Reply-To` / `References`.
 *
 * We don't use `nodemailer.compose()` directly because we want explicit
 * control over the Message-ID we stamp (it goes into
 * `conv_message_deliveries.message_id_header` so the next inbound reply
 * threads back to this conversation).
 */

export interface BuildOutboundInput {
  /** "Acme Support <support@acme.com>" or just an email address. */
  from: string;
  /** Recipient address. */
  to: string;
  /** Reply-To header — typically the channel's `+conv-{id}` plus-address. */
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Domain to mint the local-part of the Message-ID under. Should be a
   * domain we control (the from-address's domain is fine). Used for the
   * `<…@domain>` portion of the generated header.
   */
  messageIdDomain: string;
  /** When threading off a prior outbound, the prior Message-ID. */
  inReplyTo?: string;
  /** Full chain of prior Message-IDs (RFC 5322 References). */
  references?: string[];
}

export interface BuiltMessage {
  /** RFC-822 source. */
  raw: string;
  /** The Message-ID header we stamped (without `<>` brackets). */
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
      html,
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

/**
 * Encode an RFC 2047 header value when it contains non-ASCII. Subjects
 * with emoji / accents go through here; everything else is passed through.
 */
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return `=?utf-8?B?${b64}?=`;
}

function stripDomain(host: string): string {
  return host.replace(/^.*@/, '').replace(/[\s<>]/g, '');
}

// ─── Inbound parsing helpers ───────────────────────────────────────────────
//
// The actual parsing is done by `mailparser` (in email-inbound.worker.ts)
// because it already handles MIME multipart, encodings, attachments, etc.
// What lives here are pure helpers that don't need a parser.

/**
 * Strip surrounding `<>` from a Message-ID-like string. Many headers come
 * in with brackets (`<abc@host>`); our DB stores the bare form.
 */
export function stripMessageIdBrackets(raw: string): string {
  return raw.trim().replace(/^<|>$/g, '');
}

/**
 * Pull a Message-ID list out of a `References:` or `In-Reply-To:` header.
 * Headers can have multiple bracketed ids separated by whitespace; emit
 * each one un-bracketed.
 */
export function parseMessageIdHeader(raw: string | undefined): string[] {
  if (!raw) return [];
  const matches = raw.match(/<[^<>]+>/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}

/**
 * Strip leading `Re:` / `Fwd:` (and i18n equivalents) from a subject so
 * threading-by-subject can match a reply to the original.
 */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(?:\s*(?:Re|RE|Fwd|FW|FWD|Sv|VS|Aw|AW|Antw|RIF|R)\s*:\s*)+/i, '')
    .trim();
}

/**
 * Extract the `+conv-<id>` token from any address in a recipient list.
 * Returns null if no recipient matches the plus-addressing scheme.
 *
 *   "Support <support+conv-CCV-1234@reply.example>"  →  "CCV-1234"
 *   "noreply@example.com"                             →  null
 */
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
