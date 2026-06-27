import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { sensitive } from '@getmunin/types';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import {
  ThrellClientService,
  type ThrellAccountSummary,
  type ThrellWorkerSummary,
} from './threll-client.service.ts';
import { ThrellService, jsonbToStored, type ThrellChannelDto } from './threll.service.ts';

export interface ThrellListWorkersResult {
  account: ThrellAccountSummary | null;
  workers: ThrellWorkerSummary[];
}

export const ConfigureInput = z.object({
  channelId: z
    .string()
    .optional()
    .describe('Pass an existing channel id to update; omit to create a new channel.'),
  name: z.string().min(1).max(120).optional(),
  apiKey: sensitive(
    z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'Threll API key (Settings → Developer). Sent as the `x-api-key` header. Required on create.',
      ),
  ),
  accountId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Threll account ID. Optional — derived from the API key (one account per key) when omitted.'),
  workerId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Threll worker ID that handles calls on this channel. Required on create.'),
  replaceWebhook: z
    .boolean()
    .optional()
    .describe(
      'Set true to delete a conflicting account-wide webhook subscription and register Munin’s. Without it, a conflict returns a 409 webhook_conflict error.',
    ),
});

@Injectable()
export class ThrellAdminService {
  constructor(
    @Inject(ThrellService) private readonly svc: ThrellService,
    @Inject(ThrellClientService) private readonly client: ThrellClientService,
  ) {}

  async configure(args: z.infer<typeof ConfigureInput>): Promise<ThrellChannelDto> {
    if (args.channelId) {
      return this.svc.updateChannel({
        channelId: args.channelId,
        name: args.name,
        config: {
          apiKey: args.apiKey,
          accountId: args.accountId,
          workerId: args.workerId,
        },
      });
    }
    if (!args.name) throw new BadRequestException('name is required when creating a channel');
    if (!args.apiKey) throw new BadRequestException('apiKey is required when creating');
    if (!args.workerId) throw new BadRequestException('workerId is required when creating');
    return this.svc.createChannel({
      name: args.name,
      config: {
        apiKey: args.apiKey,
        accountId: args.accountId,
        workerId: args.workerId,
      },
      replaceWebhook: args.replaceWebhook,
    });
  }

  async listWorkers(args: { apiKey: string; accountId?: string }): Promise<ThrellListWorkersResult> {
    const account = args.accountId
      ? await this.client.fetchAccount({ apiKey: args.apiKey, accountId: args.accountId })
      : await this.client.fetchCurrentAccount({ apiKey: args.apiKey });
    if (!account.ok) throw new BadRequestException(account.error);
    const workers = await this.client.listWorkers({
      apiKey: args.apiKey,
      accountId: account.account.id,
    });
    if (!workers.ok) throw new BadRequestException(workers.error);
    return { account: account.account, workers: workers.workers };
  }

  async listWorkersForChannel(args: { channelId: string }): Promise<ThrellListWorkersResult> {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    return this.listWorkers({ apiKey, accountId: config.accountId });
  }

  async testChannel(
    args: { channelId: string },
  ): Promise<
    { ok: true; worker: { id: string; name: string | null } } | { ok: false; error: string }
  > {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    return this.client.fetchWorker({
      apiKey,
      accountId: config.accountId,
      workerId: config.workerId,
    });
  }

  async callInitiate(
    args: { channelId: string; to: string; customerName?: string },
  ): Promise<{ initiated: true; callId: string; status: string }> {
    const channel = await this.loadChannel(args.channelId);
    const config = jsonbToStored(channel.config);
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    try {
      const res = await this.client.placeCall({
        apiKey,
        accountId: config.accountId,
        workerId: config.workerId,
        toNumber: args.to,
        customer: args.customerName ? { firstName: args.customerName } : undefined,
      });
      return { initiated: true, callId: res.id, status: res.status };
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
    if (channel.type !== 'voice' || channel.vendor !== 'threll') {
      throw new BadRequestException(`channel ${channelId} is not a voice:threll channel`);
    }
    return channel;
  }
}
