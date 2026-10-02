import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  STREX_KEYWORD,
  STREX_SHORT_NUMBER_ID,
  StrexEnvironmentSchema,
  sensitive,
  AgentModeSchema,
} from '@getmunin/types';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { StrexClientService, buildStrexWebhookUrl } from './strex-client.service.ts';
import { StrexSmsService, jsonbToStored, type StrexSmsChannelDto } from './strex-sms.service.ts';

export const ConfigureInput = z.object({
  channelId: z
    .string()
    .optional()
    .describe('Pass an existing channel id to update; omit to create a new channel.'),
  name: z.string().min(1).max(120).optional(),
  defaultAgentMode: AgentModeSchema.optional().describe(
    "How the agent handles inbound texts on this channel: 'auto' replies directly, 'draft_only' files a draft for a human, 'off' does neither. Set 'draft_only' on an outreach-only number so replies are never auto-sent.",
  ),
  apiKey: sensitive(
    z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe(
        'Strex Connect API key (gear icon → API keys), sent as the X-ApiKey header. Required on create. On update, omit to keep the existing value.',
      ),
  ),
  sender: z
    .string()
    .min(1)
    .max(15)
    .optional()
    .describe(
      'Sender shown on outbound texts: the short number (e.g. "2002") so customers can reply, or an alphanumeric sender up to 11 characters for outbound-only. Required on create.',
    ),
  shortNumberId: z
    .string()
    .regex(STREX_SHORT_NUMBER_ID, 'must look like NO-2002')
    .nullable()
    .optional()
    .describe(
      'Strex short number that receives replies, e.g. "NO-2002". When set, Munin registers a keyword on it that forwards inbound texts to this channel. Omit for an outbound-only channel; pass null on update to stop receiving.',
    ),
  keyword: z
    .string()
    .regex(STREX_KEYWORD, 'must be a single word')
    .nullable()
    .optional()
    .describe(
      'Keyword that routes texts on a shared short number to this channel (matched on the first word, so customers write e.g. "ACME my order is late"). Omit on a dedicated short number to receive every text; pass null on update to switch back to that catch-all.',
    ),
  environment: StrexEnvironmentSchema.optional().describe(
    "'production' (default) or 'test' — the Strex test platform, for trying the integration without sending real texts.",
  ),
});

@Injectable()
export class StrexSmsAdminService {
  constructor(
    @Inject(StrexSmsService) private readonly svc: StrexSmsService,
    @Inject(StrexClientService) private readonly client: StrexClientService,
  ) {}

  completeSetup(
    channelId: string,
    secrets: Record<string, string>,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    return this.svc.completeSetup(channelId, secrets);
  }

  async configure(args: z.infer<typeof ConfigureInput>): Promise<StrexSmsChannelDto> {
    if (args.channelId) {
      return this.svc.updateChannel({
        channelId: args.channelId,
        name: args.name,
        defaultAgentMode: args.defaultAgentMode,
        config: {
          apiKey: args.apiKey,
          sender: args.sender,
          environment: args.environment,
          shortNumberId: args.shortNumberId,
          keyword: args.keyword,
        },
      });
    }
    if (!args.name) throw new BadRequestException('name is required when creating a channel');
    if (!args.apiKey) throw new BadRequestException('apiKey is required when creating');
    if (!args.sender) throw new BadRequestException('sender is required when creating');
    return this.svc.createChannel({
      name: args.name,
      defaultAgentMode: args.defaultAgentMode,
      config: {
        apiKey: args.apiKey,
        sender: args.sender,
        environment: args.environment,
        ...(args.shortNumberId ? { shortNumberId: args.shortNumberId } : {}),
        ...(args.keyword ? { keyword: args.keyword } : {}),
      },
    });
  }

  async testChannel(args: { channelId: string }): Promise<
    | {
        ok: true;
        inbound:
          | { configured: false }
          | {
              configured: true;
              keywordId: string;
              registered: boolean;
              enabled: boolean;
              forwardsToMunin: boolean;
            };
      }
    | { ok: false; error: string }
  > {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const creds = {
      apiKey: await this.client.loadSecret(config.encryptedApiKey),
      environment: config.environment,
    };
    const auth = await this.client.verifyApiKey(creds);
    if (!auth.ok) return auth;
    if (!config.keywordId) return { ok: true, inbound: { configured: false } };
    try {
      const keyword = await this.client.getKeyword(creds, config.keywordId);
      const webhookUrl = buildStrexWebhookUrl(channel.id).toLowerCase();
      return {
        ok: true,
        inbound: {
          configured: true,
          keywordId: config.keywordId,
          registered: keyword !== null,
          enabled: keyword?.enabled ?? false,
          forwardsToMunin:
            keyword?.forwardUrl
              .split('|')
              .some((u) => u.trim().toLowerCase() === webhookUrl) ?? false,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendTest(
    args: { channelId: string; to: string; body?: string },
  ): Promise<{ delivered: true; id: string; status: string }> {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    const body = args.body ?? 'Munin test message — outbound SMS is working.';
    try {
      const res = await this.client.sendSms(
        { apiKey, environment: config.environment },
        {
          transactionId: randomUUID(),
          sender: config.sender,
          recipient: args.to,
          content: body,
        },
      );
      return { delivered: true, id: res.transactionId, status: 'accepted' };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  async onArchive(channelId: string): Promise<void> {
    await this.svc.removeInboundKeyword(channelId);
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
    if (channel.type !== 'sms' || channel.vendor !== 'strex') {
      throw new BadRequestException(`channel ${channelId} is not an sms:strex channel`);
    }
    return channel;
  }
}
