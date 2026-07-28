import { Inject, Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { resolvePublicHost } from '@getmunin/core';
import type { Db } from '@getmunin/db';
import { DB } from '../../../common/db/db.module.ts';
import { EmailService, type StoredEmailChannelConfig } from './email.service.ts';

export interface EmailProbeResult {
  smtp: string;
  imap: string;
}

@Injectable()
export class EmailChannelProbe {
  constructor(
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async test(config: StoredEmailChannelConfig): Promise<EmailProbeResult> {
    const smtp = await this.testSmtp(config);
    const imap = await this.testImap(config);
    return { smtp, imap };
  }

  private async testSmtp(config: StoredEmailChannelConfig): Promise<string> {
    if (config.outbound.provider === 'mailer') return 'ok';
    try {
      const resolved = await resolvePublicHost(config.outbound.host);
      const password = await this.db.transaction((tx) =>
        this.email.decryptSmtpPassword(
          tx,
          config.outbound.provider === 'smtp' ? config.outbound.encryptedPassword : '',
        ),
      );
      const transport = createTransport({
        ...smtpTransportOptions(
          config.outbound.host,
          config.outbound.port,
          config.outbound.secure,
          { user: config.outbound.username, pass: password },
          resolved?.address,
        ),
        connectionTimeout: 5000,
        greetingTimeout: 5000,
      });
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
      return 'ok';
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async testImap(config: StoredEmailChannelConfig): Promise<string> {
    if (!config.inbound) return 'not configured';
    try {
      const resolved = await resolvePublicHost(config.inbound.host);
      const password = await this.db.transaction((tx) =>
        this.email.decryptImapPassword(tx, config.inbound!.encryptedPassword),
      );
      const client = new ImapFlow({
        host: resolved?.address ?? config.inbound.host,
        port: config.inbound.port,
        secure: config.inbound.secure,
        auth: { user: config.inbound.username, pass: password },
        logger: false,
        ...(resolved && resolved.address !== config.inbound.host
          ? { tls: { servername: config.inbound.host } }
          : {}),
      });
      try {
        await client.connect();
        await client.logout();
      } catch (err) {
        return `error: ${err instanceof Error ? err.message : String(err)}`;
      }
      return 'ok';
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export function smtpTransportOptions(
  host: string,
  port: number,
  secureHint: boolean,
  auth: { user: string; pass: string },
  resolvedAddress?: string,
): {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string };
  tls?: { servername: string };
} {
  let secure: boolean;
  let requireTLS: boolean;
  if (port === 465) {
    secure = true;
    requireTLS = false;
  } else if (port === 587 || port === 25 || port === 2525) {
    secure = false;
    requireTLS = true;
  } else {
    secure = secureHint;
    requireTLS = !secureHint;
  }
  if (resolvedAddress && resolvedAddress !== host) {
    return { host: resolvedAddress, port, secure, requireTLS, auth, tls: { servername: host } };
  }
  return { host, port, secure, requireTLS, auth };
}

export function describeSmtpError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const code = typeof e.code === 'string' ? e.code : null;
  const response = typeof e.response === 'string' ? e.response.replace(/\s+/g, ' ').trim() : null;
  if (code === 'EAUTH') {
    return response
      ? `SMTP authentication failed (${response})`
      : 'SMTP authentication failed — check the username and password.';
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'EDNS') {
    return response
      ? `Could not connect to the SMTP server (${response})`
      : 'Could not connect to the SMTP server — check the host and port.';
  }
  if (code === 'EENVELOPE') {
    return response
      ? `SMTP rejected the envelope (${response})`
      : 'SMTP rejected the sender or recipient address.';
  }
  if (response) return response;
  if (e.message) return e.message;
  if (err instanceof Error) return err.message;
  return 'SMTP transport failed';
}
