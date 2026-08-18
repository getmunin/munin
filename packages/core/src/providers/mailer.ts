import { stripTrailingSlashes } from '@getmunin/types';

export interface MailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  from?: string;
  headers?: Record<string, string>;
}

export interface Mailer {
  readonly name: string;
  readonly from: string;
  send(msg: MailMessage): Promise<void>;
}

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
    this.baseUrl = stripTrailingSlashes(opts.baseUrl ?? DEFAULT_RESEND_BASE);
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

import { createTransport, type Transporter, type SendMailOptions } from 'nodemailer';
import { parseEnvBool } from '../env/index.ts';

export interface SmtpMailerOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
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

export interface SentMessage extends MailMessage {
  sentAt: Date;
}

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
