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
import { ThrellClientService, buildWebhookUrl } from './threll-client.service.ts';

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
  accountId: z.string().min(1).max(128),
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
  }): Promise<ThrellChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const channelId = makeId('cch');
    const webhookUrl = buildWebhookUrl(channelId);
    if (!webhookUrl) throw new BadRequestException('threll_webhook_url_unavailable');
    const sub = await this.client.createWebhookSubscription({
      apiKey: input.config.apiKey,
      accountId: input.config.accountId,
      url: webhookUrl,
    });
    if (!sub.ok) throw new BadRequestException(sub.error);
    const stored = await this.toStored(input.config, sub.signingSecret);
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
    const merged: StoredThrellConfig = {
      encryptedApiKey: input.config?.apiKey
        ? await encryptString(input.config.apiKey)
        : prev.encryptedApiKey,
      encryptedWebhookSecret: prev.encryptedWebhookSecret,
      accountId: input.config?.accountId ?? prev.accountId,
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

  private async toStored(
    input: ThrellConfigInput,
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
