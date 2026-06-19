import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, and, eq } from 'drizzle-orm';
import { encryptSecretSql, getCurrentContext } from '@getmunin/core';
import { schema, makeId, type Db } from '@getmunin/db';
import { z } from 'zod';
import { DB } from '../../../common/db/db.module.ts';
import {
  ThrellClientService,
  buildWebhookUrl,
  type ThrellWebhookSubscriptionSummary,
} from './threll-client.service.ts';

const REDACTED = '••••';

export const StoredThrellConfigSchema = z.object({
  encryptedApiKey: z.string().min(1),
  encryptedWebhookSecret: z.string().min(1),
  accountId: z.string().min(1).max(128),
  workerId: z.string().min(1).max(128),
});

export type StoredThrellConfig = z.infer<typeof StoredThrellConfigSchema>;

export const ThrellConfigInputSchema = z.object({
  apiKey: z.string().min(1).max(256),
  accountId: z.string().min(1).max(128).optional(),
  workerId: z.string().min(1).max(128),
});

export type ThrellConfigInput = z.infer<typeof ThrellConfigInputSchema>;

export interface ThrellConfigDto {
  apiKey: string;
  webhookSecret: string;
  accountId: string;
  workerId: string;
}

export interface ThrellChannelDto {
  id: string;
  name: string;
  type: 'voice';
  vendor: 'threll';
  active: boolean;
  config: ThrellConfigDto;
}

@Injectable()
export class ThrellService {
  constructor(
    @Inject(DB) private readonly _db: Db,
    @Inject(ThrellClientService) private readonly client: ThrellClientService,
  ) {}

  async createChannel(input: {
    name: string;
    config: ThrellConfigInput;
    replaceWebhook?: boolean;
  }): Promise<ThrellChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const channelId = makeId('cch');
    const webhookUrl = buildWebhookUrl(channelId);
    const accountId = input.config.accountId ?? (await this.resolveAccountId(input.config.apiKey));
    const config = { ...input.config, accountId };
    const signingSecret = await this.ensureWebhookSubscription(
      { apiKey: config.apiKey, accountId },
      webhookUrl,
      input.replaceWebhook ?? false,
    );
    const stored = await this.toStored(config, signingSecret);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        id: channelId,
        orgId: actor.orgId,
        type: 'voice',
        vendor: 'threll',
        name: input.name,
        config: storedToJsonb(stored),
      })
      .returning();
    if (!row) throw new ConflictException('channel_create_failed');
    return this.toDto(row.id, row.name, row.active, stored);
  }

  async updateChannel(input: {
    channelId: string;
    name?: string;
    config?: Partial<ThrellConfigInput>;
  }): Promise<ThrellChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const existing = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(
        and(
          eq(schema.convChannels.id, input.channelId),
          eq(schema.convChannels.orgId, actor.orgId),
        ),
      )
      .limit(1);
    const channel = existing[0];
    if (!channel) throw new NotFoundException(`channel ${input.channelId} not found`);
    if (channel.type !== 'voice' || channel.vendor !== 'threll') {
      throw new BadRequestException(`channel ${input.channelId} is not a voice:threll channel`);
    }
    const prev = jsonbToStored(channel.config);
    const newApiKey = input.config?.apiKey;
    const accountId =
      input.config?.accountId ??
      (newApiKey ? await this.resolveAccountId(newApiKey) : prev.accountId);
    const merged: StoredThrellConfig = {
      encryptedApiKey: newApiKey ? await encryptString(newApiKey) : prev.encryptedApiKey,
      encryptedWebhookSecret: prev.encryptedWebhookSecret,
      accountId,
      workerId: input.config?.workerId ?? prev.workerId,
    };
    const [row] = await ctx.db
      .update(schema.convChannels)
      .set({
        ...(input.name && { name: input.name }),
        config: storedToJsonb(merged),
        updatedAt: new Date(),
      })
      .where(eq(schema.convChannels.id, input.channelId))
      .returning();
    if (!row) throw new ConflictException('channel_update_failed');
    return this.toDto(row.id, row.name, row.active, merged);
  }

  private async resolveAccountId(apiKey: string): Promise<string> {
    const res = await this.client.fetchCurrentAccount({ apiKey });
    if (!res.ok) throw new BadRequestException(res.error);
    if (!res.account.id) throw new BadRequestException('threll_account_not_found');
    return res.account.id;
  }

  private async ensureWebhookSubscription(
    creds: { apiKey: string; accountId: string },
    webhookUrl: string,
    replaceWebhook: boolean,
  ): Promise<string> {
    const existing = await this.client.listWebhookSubscriptions(creds);
    if (existing.ok) {
      const reused = findReusableSigningSecret(existing.subscriptions, webhookUrl);
      if (reused) return reused;
      const conflicts = existing.subscriptions.filter(
        (s) => s.eventType === '*' && s.enabled && s.url !== webhookUrl,
      );
      if (conflicts.length > 0) {
        if (!replaceWebhook) {
          throw new ConflictException({
            code: 'webhook_conflict',
            message:
              'This Threll account already has an account-wide webhook subscription. Replace it to connect this channel.',
          });
        }
        for (const conflict of conflicts) {
          const del = await this.client.deleteWebhookSubscription({
            ...creds,
            subscriptionId: conflict.id,
          });
          if (!del.ok) throw new BadRequestException(del.error);
        }
      }
    }
    const sub = await this.client.createWebhookSubscription({ ...creds, url: webhookUrl });
    if (!sub.ok) throw new BadRequestException(sub.error);
    return sub.signingSecret;
  }

  private async toStored(
    input: ThrellConfigInput & { accountId: string },
    signingSecret: string,
  ): Promise<StoredThrellConfig> {
    return {
      encryptedApiKey: await encryptString(input.apiKey),
      encryptedWebhookSecret: await encryptString(signingSecret),
      accountId: input.accountId,
      workerId: input.workerId,
    };
  }

  private toDto(
    id: string,
    name: string,
    active: boolean,
    stored: StoredThrellConfig,
  ): ThrellChannelDto {
    return {
      id,
      name,
      type: 'voice',
      vendor: 'threll',
      active,
      config: {
        apiKey: REDACTED,
        webhookSecret: REDACTED,
        accountId: stored.accountId,
        workerId: stored.workerId,
      },
    };
  }
}

export function findReusableSigningSecret(
  subscriptions: ThrellWebhookSubscriptionSummary[],
  webhookUrl: string,
): string | null {
  const match = subscriptions.find((s) => s.url === webhookUrl && s.signingSecret);
  return match?.signingSecret ?? null;
}

export function storedToJsonb(stored: StoredThrellConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

export function jsonbToStored(json: Record<string, unknown>): StoredThrellConfig {
  return StoredThrellConfigSchema.parse(json);
}

async function encryptString(plaintext: string): Promise<string> {
  const ctx = getCurrentContext();
  const rows = await ctx.db.execute<{ ct: string } & Record<string, unknown>>(
    sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
  );
  const ct = rows[0]?.ct;
  if (!ct) throw new ConflictException('encryption_failed');
  return ct;
}
