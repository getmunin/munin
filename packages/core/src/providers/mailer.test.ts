import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readMailerFromEnv, SmtpMailer, StubMailer } from './mailer.ts';

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'stubbed' }),
  })),
}));

describe('StubMailer', () => {
  it('captures sent messages in outbox', async () => {
    const m = new StubMailer('test@example.com');
    await m.send({ to: 'kjell@example.com', subject: 'Hi', text: 'Hello' });
    expect(m.outbox).toHaveLength(1);
    expect(m.outbox[0]!.to).toBe('kjell@example.com');
    expect(m.outbox[0]!.subject).toBe('Hi');
    expect(m.outbox[0]!.text).toBe('Hello');
    expect(m.outbox[0]!.sentAt).toBeInstanceOf(Date);
  });

  it('default from is exposed', () => {
    const m = new StubMailer('me@example.com');
    expect(m.from).toBe('me@example.com');
    expect(m.name).toBe('stub');
  });

  it('clear() empties the outbox', async () => {
    const m = new StubMailer();
    await m.send({ to: 'a@example.com', subject: 'x', text: 'y' });
    m.clear();
    expect(m.outbox).toHaveLength(0);
  });
});

describe('SmtpMailer', () => {
  it('forwards messages to nodemailer with sender + headers', async () => {
    const nodemailer = await import('nodemailer');
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm-1' });
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as never);

    const m = new SmtpMailer({
      host: 'smtp.example.com',
      port: 587,
      user: 'u',
      password: 'p',
      from: 'Munin <hello@example.com>',
    });

    await m.send({
      to: 'kjell@example.com',
      subject: 'Hi',
      text: 'Hello',
      headers: { 'X-Trace': 'abc' },
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      from: 'Munin <hello@example.com>',
      to: 'kjell@example.com',
      subject: 'Hi',
      text: 'Hello',
      headers: { 'X-Trace': 'abc' },
    });
  });

  it('per-message from overrides default', async () => {
    const nodemailer = await import('nodemailer');
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm-2' });
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as never);

    const m = new SmtpMailer({
      host: 'h',
      port: 25,
      user: 'u',
      password: 'p',
      from: 'default@example.com',
    });
    await m.send({ to: 't@example.com', subject: 's', text: 'b', from: 'override@example.com' });
    expect(sendMail.mock.calls[0]![0]).toMatchObject({ from: 'override@example.com' });
  });

  it('throws when neither text nor html provided', async () => {
    const m = new SmtpMailer({ host: 'h', port: 25, user: 'u', password: 'p', from: 'x@example.com' });
    await expect(m.send({ to: 't@example.com', subject: 's' })).rejects.toThrow(/text.*html/);
  });
});

describe('readMailerFromEnv', () => {
  const baseEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...baseEnv };
    delete process.env.MUNIN_MAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.MUNIN_SMTP_HOST;
    delete process.env.MUNIN_SMTP_PORT;
    delete process.env.MUNIN_SMTP_USER;
    delete process.env.MUNIN_SMTP_PASSWORD;
    delete process.env.MUNIN_SMTP_SECURE;
  });
  afterEach(() => {
    process.env = baseEnv;
  });

  it('returns SmtpMailer when MUNIN_MAIL_PROVIDER=smtp and creds present', () => {
    process.env.MUNIN_MAIL_PROVIDER = 'smtp';
    process.env.MUNIN_SMTP_HOST = 'smtp.tem.scw.cloud';
    process.env.MUNIN_SMTP_PORT = '587';
    process.env.MUNIN_SMTP_USER = 'tem-user';
    process.env.MUNIN_SMTP_PASSWORD = 'tem-pass';
    expect(readMailerFromEnv()).toBeInstanceOf(SmtpMailer);
  });

  it('throws when MUNIN_MAIL_PROVIDER=smtp without creds', () => {
    process.env.MUNIN_MAIL_PROVIDER = 'smtp';
    expect(() => readMailerFromEnv()).toThrow(/MUNIN_SMTP_HOST/);
  });

  it('falls back to StubMailer when no provider configured', () => {
    expect(readMailerFromEnv()).toBeInstanceOf(StubMailer);
  });
});
