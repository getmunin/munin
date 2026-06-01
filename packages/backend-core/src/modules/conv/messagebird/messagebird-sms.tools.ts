import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { sensitive } from '@getmunin/types';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { MessageBirdClientService } from './messagebird-client.service.ts';
import {
  MessageBirdSmsService,
  jsonbToStored,
  type MessageBirdSmsChannelDto,
} from './messagebird-sms.service.ts';

const ConfigureInput = z.object({
  channelId: z
    .string()
    .optional()
    .describe('Pass an existing channel id to update; omit to create a new channel.'),
  name: z.string().min(1).max(120).optional(),
  accessKey: sensitive(
    z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'MessageBird live or test Access Key (used to authorize outbound SMS). Required on create. On update, omit to keep the existing value.',
      ),
  ),
  signingKey: sensitive(
    z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'MessageBird signing key (used to verify the JWT on incoming webhooks). Required on create. On update, omit to keep the existing value.',
      ),
  ),
  originator: z
    .string()
    .min(1)
    .max(32)
    .optional()
    .describe(
      'Sender ID — either an E.164 number registered with your MessageBird account or an alphanumeric ≤ 11 chars. Required on create.',
    ),
});

const TestInput = z.object({ channelId: z.string() });

const SendTestInput = z.object({
  channelId: z.string(),
  to: z.string().min(2).max(32).describe('E.164 destination number.'),
  body: z.string().min(1).max(1600).optional(),
});

@Injectable()
export class MessageBirdSmsAdminTools {
  constructor(
    @Inject(MessageBirdSmsService) private readonly svc: MessageBirdSmsService,
    @Inject(MessageBirdClientService) private readonly client: MessageBirdClientService,
  ) {}

  @McpTool({
    name: 'conv_messagebird_sms_configure',
    title: 'Conv: Configure MessageBird SMS channel',
    description:
      'Create or update a MessageBird SMS channel. Pass `channelId` to update; omit to create. The plaintext `accessKey` and `signingKey` are encrypted before storage and returned redacted. On update, omit either secret to keep the existing one.',
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ConfigureInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async configure(args: z.infer<typeof ConfigureInput>): Promise<MessageBirdSmsChannelDto> {
    if (args.channelId) {
      return this.svc.updateChannel({
        channelId: args.channelId,
        name: args.name,
        config: {
          accessKey: args.accessKey,
          signingKey: args.signingKey,
          originator: args.originator,
        },
      });
    }
    if (!args.name) throw new BadRequestException('name is required when creating a channel');
    if (!args.accessKey) throw new BadRequestException('accessKey is required when creating');
    if (!args.signingKey) throw new BadRequestException('signingKey is required when creating');
    if (!args.originator) throw new BadRequestException('originator is required when creating');
    return this.svc.createChannel({
      name: args.name,
      config: {
        accessKey: args.accessKey,
        signingKey: args.signingKey,
        originator: args.originator,
      },
    });
  }

  @McpTool({
    name: 'conv_messagebird_sms_test_channel',
    title: 'Conv: Test MessageBird SMS channel credentials',
    description:
      "Verify a MessageBird channel's stored Access Key by fetching the account balance. Returns `{ ok: true, balance }` on success.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: TestInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async testChannel(args: z.infer<typeof TestInput>): Promise<
    { ok: true; balance: unknown } | { ok: false; error: string }
  > {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const accessKey = await this.client.loadSecret(config.encryptedAccessKey);
    return this.client.verifyAccessKey(accessKey);
  }

  @McpTool({
    name: 'conv_messagebird_sms_send_test',
    title: 'Conv: Send a real test SMS via MessageBird',
    description:
      "Send a real SMS through this channel's MessageBird account. Useful for end-to-end deliverability checks.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: SendTestInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  async sendTest(
    args: z.infer<typeof SendTestInput>,
  ): Promise<{ delivered: true; id: string; status: string }> {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const accessKey = await this.client.loadSecret(config.encryptedAccessKey);
    const body = args.body ?? 'Munin test message — outbound SMS is working.';
    try {
      const recipient = args.to.startsWith('+') ? args.to.slice(1) : args.to;
      const res = await this.client.sendSms({
        accessKey,
        originator: config.originator,
        recipient,
        body,
      });
      return { delivered: true, id: res.id, status: res.status };
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
    if (channel.type !== 'sms' || channel.vendor !== 'messagebird') {
      throw new BadRequestException(`channel ${channelId} is not an sms:messagebird channel`);
    }
    return channel;
  }
}
