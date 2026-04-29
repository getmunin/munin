/**
 * Transactional email abstraction.
 *
 * Pluggable so self-hosters can pick Resend, Scaleway Transactional Email,
 * Postmark, SES, or a local SMTP. Munin's hosted deployment will run on
 * Scaleway TX Email (EU sovereignty); the OSS image defaults to Resend
 * since that's the lowest-friction option for OSS users.
 */

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. At least one of `text` or `html` is required. */
  text?: string;
  /** HTML body. */
  html?: string;
  replyTo?: string;
  /**
   * Override the Mailer's default sender for this message. Used by the
   * email-channel outbound worker so per-channel `from` addresses (e.g.
   * "Acme Support <support@acme.com>") flow through the same Mailer
   * instance the rest of the app uses for verify / reset / invite mail.
   */
  from?: string;
  /**
   * Extra headers to stamp on the outgoing message. The email-channel
   * worker uses this for `Message-ID`, `In-Reply-To`, `References`.
   * Mailers that don't support custom headers (e.g. some hosted APIs)
   * should pass through the ones they can and ignore the rest.
   */
  headers?: Record<string, string>;
}

export interface Mailer {
  /** Identifier for telemetry / logs. */
  readonly name: string;
  /** Default `from` address; senders may override per-message later if needed. */
  readonly from: string;
  send(msg: MailMessage): Promise<void>;
}

// ─── Resend ──────────────────────────────────────────────────────────────────

export interface ResendMailerOptions {
  apiKey: string;
  from: string;
  baseUrl?: string;
}

const DEFAULT_RESEND_BASE = 'https://api.resend.com';

export class ResendMailer implements Mailer {
  readonly name = 'resend';
  readonly from: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: ResendMailerOptions) {
    this.apiKey = opts.apiKey;
    this.from = opts.from;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_RESEND_BASE).replace(/\/+$/, '');
  }

  async send(msg: MailMessage): Promise<void> {
    if (!msg.text && !msg.html) {
      throw new Error('mailer: at least one of `text` or `html` is required');
    }
    const res = await fetch(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: msg.from ?? this.from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        reply_to: msg.replyTo,
        headers: msg.headers,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`resend send failed: ${res.status} ${body}`);
    }
  }
}

// ─── Stub (collects in-memory; for tests + offline dev) ──────────────────────

export interface SentMessage extends MailMessage {
  sentAt: Date;
}

/**
 * Collects messages in memory instead of sending. Used in tests and as the
 * default when no email provider is configured (so dev-mode signups don't
 * blow up just because RESEND_API_KEY isn't set yet).
 */
export class StubMailer implements Mailer {
  readonly name = 'stub';
  readonly from: string;
  readonly outbox: SentMessage[] = [];

  constructor(from = 'no-reply@example.com') {
    this.from = from;
  }

  send(msg: MailMessage): Promise<void> {
    this.outbox.push({ ...msg, sentAt: new Date() });
    return Promise.resolve();
  }

  clear(): void {
    this.outbox.length = 0;
  }
}

// ─── Env-based factory ───────────────────────────────────────────────────────

/**
 * Resolve a Mailer from environment.
 *
 * `MUNIN_MAIL_PROVIDER`:
 *   `resend` — HTTP send via Resend (requires RESEND_API_KEY).
 *   `stub`   — in-memory; default when no provider is configured.
 *
 * `MUNIN_MAIL_FROM` — sender address (e.g. "Munin <hello@getmunin.com>").
 */
export function readMailerFromEnv(): Mailer {
  const provider = process.env.MUNIN_MAIL_PROVIDER?.toLowerCase();
  const from = process.env.MUNIN_MAIL_FROM ?? 'Munin <no-reply@getmunin.com>';
  if (provider === 'stub') return new StubMailer(from);
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey || provider === 'resend') {
    if (!apiKey) {
      throw new Error('MUNIN_MAIL_PROVIDER=resend requires RESEND_API_KEY');
    }
    return new ResendMailer({ apiKey, from });
  }
  return new StubMailer(from);
}
