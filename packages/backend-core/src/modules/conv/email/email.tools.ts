import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { schema, type Db } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext, resolvePublicHost, type Mailer } from '@getmunin/core';
import { renderChannelTestEmail } from '@getmunin/emails';
import { createTransport } from 'nodemailer';
import { AgentModeSchema } from '@getmunin/types';
import { DB } from '../../../common/db/db.module.ts';
import { MAILER } from '../../../common/mail/mail.module.ts';
import { ChannelCredentialService } from '../channels/channel-credential.service.ts';
import {
  ChannelReactivationService,
  type ChannelReactivator,
} from '../channels/channel-reactivation.service.ts';
import {
  EmailChannelProbe,
  describeSmtpError,
  smtpTransportOptions,
} from './email-probe.service.ts';
import { EmailService, EmailChannelConfigInput, jsonbToStored } from './email.service.ts';

const SetupInput = z.object({
  channelId: z.string().optional(),
  name: z.string().min(1).max(120),
  config: EmailChannelConfigInput,
  defaultAgentMode: AgentModeSchema.optional(),
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
    @Inject(EmailChannelProbe) private readonly probe: EmailChannelProbe,
    @Inject(ChannelCredentialService) private readonly credentials: ChannelCredentialService,
    @Inject(ChannelReactivationService) private readonly reactivation: ChannelReactivator,
    @Inject(DB) private readonly serviceDb: Db,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  @McpTool({
    name: 'conv_configure_email_channel',
    title: 'Conv: Configure an email channel',
    description:
      "Create or update an email channel's transport configuration with the non-secret fields only. SMTP / IMAP passwords are rejected here: the channel is created inactive and the response includes a one-time link for a human to enter the passwords in the dashboard — the channel activates once they are saved. Updating a channel that is currently deactivated (for example after repeated inbound polling failures) re-tests the stored credentials: the channel is reactivated when SMTP and IMAP both connect, and otherwise stays deactivated with the connection errors in the `probe` field of the response. Set `outbound.provider: 'mailer'` to send via Munin's configured Resend mailer instead of a custom SMTP host (no password needed, channel is active immediately). Set `defaultAgentMode: 'draft_only'` so the agent answers into an internal draft that a human reviews and sends, instead of replying to the sender itself — use it to run an inbox with a human in the loop, or on an outreach-only inbox where a reply must never be auto-sent.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SetupInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async setupChannel(args: z.infer<typeof SetupInput>) {
    if (args.channelId) {
      const updated = await this.email.updateChannel(
        {
          channelId: args.channelId,
          name: args.name,
          config: args.config,
          defaultAgentMode: args.defaultAgentMode,
        },
        { rejectSecrets: true },
      );
      if (updated.active) return updated;
      const reactivation = await this.reactivation.reactivateIfHealthy(args.channelId);
      return {
        ...updated,
        active: reactivation.active,
        ...(reactivation.probe ? { probe: reactivation.probe } : {}),
      };
    }
    const channel = await this.email.createChannel(
      {
        name: args.name,
        config: args.config,
        defaultAgentMode: args.defaultAgentMode,
      },
      { rejectSecrets: true },
    );
    if (channel.active) return channel;
    const credentialLink = await this.credentials.requestLink(channel.id);
    return { ...channel, credentialLink };
  }

  @McpTool({
    name: 'conv_test_email_channel',
    title: 'Conv: Test email channel credentials',
    description:
      'Test an email channel\'s stored credentials. Attempts an SMTP connect (and an IMAP connect if inbound is configured) without sending or fetching anything. Returns `{ smtp: "ok" | error, imap: "ok" | error | "not configured" }`.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: TestInput,
    readOnlyHint: false,
    destructiveHint: true,
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
    return this.probe.test(jsonbToStored(channel.config));
  }

  @McpTool({
    name: 'conv_send_email_channel_test',
    title: 'Conv: Send a test email',
    description:
      "Send a real test email through this channel's configured outbound transport (SMTP or Mailer). The message is addressed `to` the recipient you pass in. Useful for confirming credentials and deliverability end-to-end.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SendTestInput,
    readOnlyHint: false,
    destructiveHint: true,
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
        const resolved = await resolvePublicHost(config.outbound.host);
        const password = await this.serviceDb.transaction((tx) =>
          this.email.decryptSmtpPassword(tx, config.outbound.provider === 'smtp' ? config.outbound.encryptedPassword : ''),
        );
        const transport = createTransport(
          smtpTransportOptions(
            config.outbound.host,
            config.outbound.port,
            config.outbound.secure,
            { user: config.outbound.username, pass: password },
            resolved?.address,
          ),
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

}
