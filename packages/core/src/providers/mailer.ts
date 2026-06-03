/**
 * Transactional email abstraction.
 *
 * Pluggable so self-hosters can pick Resend, Postmark, SES, or a local
 * SMTP. Defaults to Resend since that's the lowest-friction option.
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

// ─── Generic SMTP (covers Scaleway TEM, Postmark, Mailgun, etc.) ────────────

import { createTransport, type Transporter, type SendMailOptions } from 'nodemailer';
import { parseEnvBool } from '../env/index.ts';

export interface SmtpMailerOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  /** When true, uses TLS from the start (implicit TLS, typically port 465). When false (default), starts plain and upgrades via STARTTLS. */
  secure?: boolean;
}

export class SmtpMailer implements Mailer {
  readonly name = 'smtp';
  readonly from: string;
  private readonly transporter: Transporter;

  constructor(opts: SmtpMailerOptions) {
    this.from = opts.from;
    this.transporter = createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure ?? false,
      auth: { user: opts.user, pass: opts.password },
    });
  }

  async send(msg: MailMessage): Promise<void> {
    if (!msg.text && !msg.html) {
      throw new Error('mailer: at least one of `text` or `html` is required');
    }
    const mail: SendMailOptions = {
      from: msg.from ?? this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      replyTo: msg.replyTo,
      headers: msg.headers,
    };
    await this.transporter.sendMail(mail);
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
    if (process.env.NODE_ENV !== 'test') {
      const to = Array.isArray(msg.to) ? msg.to.join(', ') : msg.to;
      const body = (msg.text ?? '').slice(0, 600);
      console.log(`\n[mail:stub] to=${to}\n           subject=${msg.subject}\n${body}\n`);
    }
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
 *   `smtp`   — Generic SMTP (Scaleway TEM, Postmark, Mailgun, …). Requires
 *              MUNIN_SMTP_HOST, MUNIN_SMTP_PORT, MUNIN_SMTP_USER,
 *              MUNIN_SMTP_PASSWORD. Optional MUNIN_SMTP_SECURE=1 forces
 *              implicit TLS (port 465); otherwise STARTTLS is used.
 *   `stub`   — in-memory; default when no provider is configured.
 *
 * `MUNIN_MAIL_FROM` — sender address (e.g. "Munin <hello@getmunin.com>").
 */
export function readMailerFromEnv(): Mailer {
  const provider = process.env.MUNIN_MAIL_PROVIDER?.toLowerCase();
  const from = process.env.MUNIN_MAIL_FROM ?? 'Munin <no-reply@getmunin.com>';
  if (provider === 'stub') return new StubMailer(from);
  if (provider === 'smtp') {
    const host = process.env.MUNIN_SMTP_HOST;
    const port = Number(process.env.MUNIN_SMTP_PORT);
    const user = process.env.MUNIN_SMTP_USER;
    const password = process.env.MUNIN_SMTP_PASSWORD;
    if (!host || !Number.isFinite(port) || !user || !password) {
      throw new Error(
        'MUNIN_MAIL_PROVIDER=smtp requires MUNIN_SMTP_HOST, MUNIN_SMTP_PORT, MUNIN_SMTP_USER, MUNIN_SMTP_PASSWORD',
      );
    }
    return new SmtpMailer({
      host,
      port,
      user,
      password,
      from,
      secure: parseEnvBool({ name: 'MUNIN_SMTP_SECURE', default: false }),
    });
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey || provider === 'resend') {
    if (!apiKey) {
      throw new Error('MUNIN_MAIL_PROVIDER=resend requires RESEND_API_KEY');
    }
    return new ResendMailer({ apiKey, from });
  }
  return new StubMailer(from);
}
