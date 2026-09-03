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
import { readPendingSetup } from '../channels/channel-admin.ts';
import {
  ThrellClientService,
  buildWebhookUrl,
  type ThrellWebhookSubscriptionSummary,
} from './threll-client.service.ts';
import { parseStoredConfig } from '../channels/stored-config.ts';

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
      { apiKey: config.apiKey, accountId, workerId: config.workerId },
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

  async completeSetup(
    channelId: string,
    secrets: Record<string, string>,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [channel] = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, actor.orgId)))
      .limit(1);
    if (!channel || channel.vendor !== 'threll') {
      return { ok: false, error: 'channel no longer exists' };
    }
    const pending = readPendingSetup(channel.config);
    const base = pending ?? nonSecretParts(jsonbToStored(channel.config));
    const parsed = ThrellConfigInputSchema.safeParse({ ...base, ...secrets });
    if (!parsed.success) {
      throw new BadRequestException(`conv_invalid: config for threll: ${flattenError(parsed.error)}`);
    }
    const accountId = parsed.data.accountId ?? (await this.resolveAccountId(parsed.data.apiKey));
    const signingSecret = await this.ensureWebhookSubscription(
      { apiKey: parsed.data.apiKey, accountId, workerId: parsed.data.workerId },
      buildWebhookUrl(channelId),
      pending?.replaceWebhook === true,
    );
    const stored = await this.toStored({ ...parsed.data, accountId }, signingSecret);
    await ctx.db
      .update(schema.convChannels)
      .set({ config: storedToJsonb(stored), active: true, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, channelId));
    return { ok: true, detail: 'credentials saved; webhook subscription configured' };
  }

  async updateChannel(input: {
    channelId: string;
    name?: string;
    config?: Partial<ThrellConfigInput>;
    replaceWebhook?: boolean;
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
    const workerId = input.config?.workerId ?? prev.workerId;
    const merged: StoredThrellConfig = {
      encryptedApiKey: newApiKey ? await encryptString(newApiKey) : prev.encryptedApiKey,
      encryptedWebhookSecret: prev.encryptedWebhookSecret,
      accountId,
      workerId,
    };
    if (workerId !== prev.workerId || accountId !== prev.accountId) {
      const apiKey = newApiKey ?? (await this.client.loadSecret(prev.encryptedApiKey));
      const webhookUrl = buildWebhookUrl(input.channelId);
      const signingSecret = await this.ensureWebhookSubscription(
        { apiKey, accountId, workerId },
        webhookUrl,
        input.replaceWebhook ?? false,
      );
      const removalApiKey =
        accountId !== prev.accountId && newApiKey
          ? await this.client.loadSecret(prev.encryptedApiKey)
          : apiKey;
      await this.removeWebhookSubscription(
        { apiKey: removalApiKey, accountId: prev.accountId, workerId: prev.workerId },
        webhookUrl,
      );
      merged.encryptedWebhookSecret = await encryptString(signingSecret);
    }
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
    creds: { apiKey: string; accountId: string; workerId: string },
    webhookUrl: string,
    replaceWebhook: boolean,
  ): Promise<string> {
    const existing = await this.client.listWebhookSubscriptions(creds);
    if (existing.ok) {
      const scoped = existing.subscriptions.filter((s) => s.workerId === creds.workerId);
      const reused = findReusableSigningSecret(scoped, webhookUrl);
      if (reused) return reused;
      const enabled = scoped.filter((s) => s.eventType === '*' && s.enabled);
      await this.deleteSubscriptions(
        creds,
        enabled.filter((s) => s.url === webhookUrl),
      );
      const conflicts = enabled.filter((s) => s.url !== webhookUrl);
      if (conflicts.length > 0) {
        if (!replaceWebhook) {
          throw new ConflictException({
            code: 'webhook_conflict',
            message:
              'This Threll worker already has a webhook subscription pointing elsewhere. Replace it to connect this channel.',
          });
        }
        await this.deleteSubscriptions(creds, conflicts);
      }
    }
    const sub = await this.client.createWebhookSubscription({ ...creds, url: webhookUrl });
    if (!sub.ok) throw new BadRequestException(sub.error);
    return sub.signingSecret;
  }

  private async removeWebhookSubscription(
    creds: { apiKey: string; accountId: string; workerId: string },
    webhookUrl: string,
  ): Promise<void> {
    const existing = await this.client.listWebhookSubscriptions(creds);
    if (!existing.ok) return;
    await this.deleteSubscriptions(
      creds,
      existing.subscriptions.filter((s) => s.workerId === creds.workerId && s.url === webhookUrl),
    );
  }

  private async deleteSubscriptions(
    creds: { apiKey: string; accountId: string },
    subscriptions: ThrellWebhookSubscriptionSummary[],
  ): Promise<void> {
    for (const subscription of subscriptions) {
      const del = await this.client.deleteWebhookSubscription({
        apiKey: creds.apiKey,
        accountId: creds.accountId,
        subscriptionId: subscription.id,
      });
      if (!del.ok) throw new BadRequestException(del.error);
    }
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

function nonSecretParts(stored: StoredThrellConfig): Record<string, unknown> {
  return { accountId: stored.accountId, workerId: stored.workerId };
}

function flattenError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
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
  return parseStoredConfig(StoredThrellConfigSchema, json, 'voice:threll');
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
