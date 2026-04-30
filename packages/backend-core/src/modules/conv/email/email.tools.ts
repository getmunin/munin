import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { schema, type Db } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { createTransport } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { DB } from '../../../common/db/db.module.js';
import {
  EmailService,
  EmailChannelConfigInput,
  jsonbToStored,
  type StoredEmailChannelConfig,
} from './email.service.js';

const SetupInput = z.object({
  /** Pass to update an existing channel; omit to create one. */
  channelId: z.string().optional(),
  name: z.string().min(1).max(120),
  config: EmailChannelConfigInput,
});

const TestInput = z.object({
  channelId: z.string(),
});

@Injectable()
export class EmailAdminTools {
  constructor(
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(DB) private readonly serviceDb: Db,
  ) {}

  @McpTool({
    name: 'conv_email_setup_channel',
    title: 'Set up email channel',
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
    title: 'Test email channel credentials',
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

  private async testSmtp(config: StoredEmailChannelConfig): Promise<string> {
    if (config.outbound.provider === 'mailer') return 'ok';
    try {
      const password = await this.serviceDb.transaction((tx) =>
        this.email.decryptSmtpPassword(
          tx,
          config.outbound.provider === 'smtp' ? config.outbound.encryptedPassword : '',
        ),
      );
      const transport = createTransport({
        host: config.outbound.host,
        port: config.outbound.port,
        secure: config.outbound.secure,
        auth: { user: config.outbound.username, pass: password },
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
