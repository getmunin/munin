import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
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

export const ConfigureInput = z.object({
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

@Injectable()
export class MessageBirdSmsAdminService {
  constructor(
    @Inject(MessageBirdSmsService) private readonly svc: MessageBirdSmsService,
    @Inject(MessageBirdClientService) private readonly client: MessageBirdClientService,
  ) {}

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

  async testChannel(args: { channelId: string }): Promise<
    { ok: true; balance: unknown } | { ok: false; error: string }
  > {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const accessKey = await this.client.loadSecret(config.encryptedAccessKey);
    return this.client.verifyAccessKey(accessKey);
  }

  async sendTest(
    args: { channelId: string; to: string; body?: string },
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
