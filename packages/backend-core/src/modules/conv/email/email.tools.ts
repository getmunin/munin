import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { schema, type Db } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { assertPublicHost, getCurrentContext, type Mailer } from '@getmunin/core';
import { renderChannelTestEmail } from '@getmunin/emails';
import { createTransport } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { DB } from '../../../common/db/db.module.ts';
import { MAILER } from '../../../common/mail/mail.module.ts';
import {
  EmailService,
  EmailChannelConfigInput,
  jsonbToStored,
  type StoredEmailChannelConfig,
} from './email.service.ts';

const SetupInput = z.object({
  /** Pass to update an existing channel; omit to create one. */
  channelId: z.string().optional(),
  name: z.string().min(1).max(120),
  config: EmailChannelConfigInput,
});

const TestInput = z.object({
  channelId: z.string(),
});

const SendTestInput = z.object({
  channelId: z.string(),
  to: z.string().email(),
});

@Injectable()
export class EmailAdminTools {
  constructor(
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(DB) private readonly serviceDb: Db,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  @McpTool({
    name: 'conv_email_setup_channel',
    title: 'Conv: Set up email channel',
    description:
      "Create or update an email channel's transport configuration. Pass plaintext SMTP / IMAP passwords; the server encrypts them before storage and returns them redacted. Set `outbound.provider: 'mailer'` to send via Munin's configured Resend mailer instead of a custom SMTP host.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SetupInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async setupChannel(args: z.infer<typeof SetupInput>) {
    if (args.channelId) {
      return this.email.updateChannel({
        channelId: args.channelId,
        name: args.name,
        config: args.config,
      });
    }
    return this.email.createChannel({ name: args.name, config: args.config });
  }

  @McpTool({
    name: 'conv_email_test_channel',
    title: 'Conv: Test email channel credentials',
    description:
      'Test an email channel\'s stored credentials. Attempts an SMTP connect (and an IMAP connect if inbound is configured) without sending or fetching anything. Returns `{ smtp: "ok" | error, imap: "ok" | error | "not configured" }`.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: TestInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async testChannel(args: z.infer<typeof TestInput>): Promise<{
    smtp: string;
    imap: string;
  }> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, args.channelId))
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new NotFoundException(`channel ${args.channelId} not found`);
    const config = jsonbToStored(channel.config);

    const smtp = await this.testSmtp(config);
    const imap = await this.testImap(config);
    return { smtp, imap };
  }

  @McpTool({
    name: 'conv_email_send_test',
    title: 'Conv: Send test email',
    description:
      "Send a real test email through this channel's configured outbound transport (SMTP or Mailer). The message is addressed `to` the recipient you pass in. Useful for confirming credentials and deliverability end-to-end.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SendTestInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async sendTest(args: z.infer<typeof SendTestInput>): Promise<{ delivered: true }> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, args.channelId))
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new NotFoundException(`channel ${args.channelId} not found`);
    const config = jsonbToStored(channel.config);

    const fromAddress = config.addressing.fromAddress;
    const fromName = config.addressing.fromName;
    const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
    const tpl = await renderChannelTestEmail({
      channelName: channel.name,
      channelAddress: fromAddress,
    });

    try {
      if (config.outbound.provider === 'smtp') {
        const password = await this.serviceDb.transaction((tx) =>
          this.email.decryptSmtpPassword(tx, config.outbound.provider === 'smtp' ? config.outbound.encryptedPassword : ''),
        );
        const transport = createTransport(
          smtpTransportOptions(config.outbound.host, config.outbound.port, config.outbound.secure, {
            user: config.outbound.username,
            pass: password,
          }),
        );
        try {
          await transport.sendMail({
            from,
            to: args.to,
            subject: tpl.subject,
            text: tpl.text,
            html: tpl.html,
            envelope: { from: fromAddress, to: args.to },
          });
        } finally {
          transport.close();
        }
      } else {
        await this.mailer.send({
          from,
          to: args.to,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
        });
      }
    } catch (err) {
      throw new BadRequestException(describeSmtpError(err));
    }

    return { delivered: true };
  }

  private async testSmtp(config: StoredEmailChannelConfig): Promise<string> {
    if (config.outbound.provider === 'mailer') return 'ok';
    try {
      await assertPublicHost(config.outbound.host);
      const password = await this.serviceDb.transaction((tx) =>
        this.email.decryptSmtpPassword(
          tx,
          config.outbound.provider === 'smtp' ? config.outbound.encryptedPassword : '',
        ),
      );
      const transport = createTransport({
        ...smtpTransportOptions(config.outbound.host, config.outbound.port, config.outbound.secure, {
          user: config.outbound.username,
          pass: password,
        }),
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
    // imapflow is loaded lazily so the dependency stays out of code paths that
    // don't need it. See M8.3 for the inbound worker that uses it for real.
    try {
      await assertPublicHost(config.inbound.host);
      const password = await this.serviceDb.transaction((tx) =>
        this.email.decryptImapPassword(tx, config.inbound!.encryptedPassword),
      );
      const client = new ImapFlow({
        host: config.inbound.host,
        port: config.inbound.port,
        secure: config.inbound.secure,
        auth: { user: config.inbound.username, pass: password },
        logger: false,
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

/**
 * Pick the right TLS mode for an SMTP host based on the port.
 *
 * Port 465 is the only port that takes implicit TLS — every other common
 * submission port (587, 25, 2525, …) expects plaintext connect + STARTTLS
 * upgrade. The stored `secure` flag is treated as a hint for ambiguous ports
 * only; the port wins when it has a well-known convention.
 */
export function smtpTransportOptions(
  host: string,
  port: number,
  secureHint: boolean,
  auth: { user: string; pass: string },
): {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string };
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
  return { host, port, secure, requireTLS, auth };
}

function describeSmtpError(err: unknown): string {
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
