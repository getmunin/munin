import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { sensitive } from '@getmunin/types';
import { schema, type Db } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { DB } from '../../../common/db/db.module.ts';
import { TwilioClientService } from './twilio-client.service.ts';
import {
  TwilioSmsService,
  jsonbToStored,
  type TwilioSmsChannelDto,
} from './twilio-sms.service.ts';

const ConfigureInput = z.object({
  channelId: z
    .string()
    .optional()
    .describe('Pass an existing channel id to update; omit to create a new channel.'),
  name: z.string().min(1).max(120).optional(),
  accountSid: z
    .string()
    .min(2)
    .max(64)
    .optional()
    .describe('Twilio Account SID — starts with "AC". Required on create.'),
  authToken: sensitive(
    z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'Twilio Auth Token (plaintext). Required on create. On update, omit to keep the existing token, or pass a new value to rotate.',
      ),
  ),
  fromNumber: z
    .string()
    .min(2)
    .max(32)
    .optional()
    .describe('E.164-formatted Twilio number to send from. Either this or messagingServiceSid is required.'),
  messagingServiceSid: z
    .string()
    .min(2)
    .max(64)
    .optional()
    .describe('Twilio Messaging Service SID (starts with "MG"). Alternative to fromNumber.'),
});

const TestInput = z.object({ channelId: z.string() });

const SendTestInput = z.object({
  channelId: z.string(),
  to: z.string().min(2).max(32).describe('E.164 destination number.'),
  body: z
    .string()
    .min(1)
    .max(1600)
    .default('Munin test message — outbound SMS is working.')
    .optional(),
});

@Injectable()
export class TwilioSmsAdminTools {
  constructor(
    @Inject(TwilioSmsService) private readonly svc: TwilioSmsService,
    @Inject(TwilioClientService) private readonly client: TwilioClientService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @McpTool({
    name: 'conv_twilio_sms_configure',
    title: 'Conv: Configure Twilio SMS channel',
    description:
      'Create or update a Twilio SMS channel. Pass `channelId` to update an existing channel; omit to create one. The plaintext `authToken` is encrypted before storage and is returned redacted. On update, omit `authToken` to keep the existing one. Either `fromNumber` (E.164) or `messagingServiceSid` is required.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ConfigureInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async configure(args: z.infer<typeof ConfigureInput>): Promise<TwilioSmsChannelDto> {
    if (args.channelId) {
      return this.svc.updateChannel({
        channelId: args.channelId,
        name: args.name,
        config: {
          accountSid: args.accountSid,
          authToken: args.authToken,
          fromNumber: args.fromNumber,
          messagingServiceSid: args.messagingServiceSid,
        },
      });
    }
    if (!args.name) throw new BadRequestException('name is required when creating a channel');
    if (!args.accountSid) throw new BadRequestException('accountSid is required when creating a channel');
    if (!args.authToken) throw new BadRequestException('authToken is required when creating a channel');
    if (!args.fromNumber && !args.messagingServiceSid) {
      throw new BadRequestException('either fromNumber or messagingServiceSid is required');
    }
    return this.svc.createChannel({
      name: args.name,
      config: {
        accountSid: args.accountSid,
        authToken: args.authToken,
        fromNumber: args.fromNumber,
        messagingServiceSid: args.messagingServiceSid,
      },
    });
  }

  @McpTool({
    name: 'conv_twilio_sms_test_channel',
    title: 'Conv: Test Twilio SMS channel credentials',
    description:
      "Verify a Twilio SMS channel's stored Account SID + Auth Token by fetching the account record from Twilio. Returns `{ ok: true, friendlyName, status }` on success.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: TestInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async testChannel(
    args: z.infer<typeof TestInput>,
  ): Promise<
    | { ok: true; friendlyName: string; status: string }
    | { ok: false; error: string }
  > {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const authToken = await this.client.loadAuthToken(config.encryptedAuthToken);
    return this.client.verifyCredentials({ accountSid: config.accountSid, authToken });
  }

  @McpTool({
    name: 'conv_twilio_sms_send_test',
    title: 'Conv: Send a real test SMS',
    description:
      "Send a real SMS through this channel's Twilio account. The recipient must be a number Twilio is permitted to reach (verified caller ID on trial accounts). Useful for end-to-end deliverability checks.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SendTestInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async sendTest(
    args: z.infer<typeof SendTestInput>,
  ): Promise<{ delivered: true; sid: string; status: string }> {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const authToken = await this.client.loadAuthToken(config.encryptedAuthToken);
    const body = args.body ?? 'Munin test message — outbound SMS is working.';
    try {
      const res = await this.client.sendSms({
        accountSid: config.accountSid,
        authToken,
        to: args.to,
        body,
        from: config.fromNumber,
        messagingServiceSid: config.messagingServiceSid,
      });
      return { delivered: true, sid: res.sid, status: res.status };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  private async loadChannel(channelId: string): Promise<typeof schema.convChannels.$inferSelect> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(
        and(
          eq(schema.convChannels.id, channelId),
          eq(schema.convChannels.orgId, actor.orgId),
        ),
      )
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new NotFoundException(`channel ${channelId} not found`);
    if (channel.type !== 'sms' || channel.vendor !== 'twilio') {
      throw new BadRequestException(`channel ${channelId} is not an sms:twilio channel`);
    }
    return channel;
  }
}
