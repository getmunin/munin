import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, and, eq } from 'drizzle-orm';
import {
  encryptSecretSql,
  getCurrentContext,
} from '@getmunin/core';
import { schema, type Db } from '@getmunin/db';
import { z } from 'zod';
import { DB } from '../../../common/db/db.module.js';

const REDACTED = '••••';

export const StoredVapiConfigSchema = z.object({
  encryptedApiKey: z.string().min(1),
  encryptedWebhookSecret: z.string().min(1),
  assistantId: z.string().min(1).max(128),
  phoneNumberId: z.string().min(1).max(128).optional(),
  publicKey: z.string().min(1).max(256).optional(),
});

export type StoredVapiConfig = z.infer<typeof StoredVapiConfigSchema>;

export const VapiConfigInputSchema = z.object({
  apiKey: z.string().min(1).max(256),
  webhookSecret: z.string().min(1).max(256),
  assistantId: z.string().min(1).max(128),
  phoneNumberId: z.string().min(1).max(128).optional(),
  publicKey: z.string().min(1).max(256).optional(),
});

export type VapiConfigInput = z.infer<typeof VapiConfigInputSchema>;

export interface VapiConfigDto {
  apiKey: string;
  webhookSecret: string;
  assistantId: string;
  phoneNumberId: string | null;
  publicKey: string | null;
}

export interface VapiChannelDto {
  id: string;
  name: string;
  type: 'voice';
  vendor: 'vapi';
  active: boolean;
  config: VapiConfigDto;
}

@Injectable()
export class VapiService {
  constructor(@Inject(DB) private readonly _db: Db) {}

  async createChannel(input: { name: string; config: VapiConfigInput }): Promise<VapiChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const stored = await this.toStored(input.config);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'voice',
        vendor: 'vapi',
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
    config?: Partial<VapiConfigInput>;
  }): Promise<VapiChannelDto> {
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
    if (channel.type !== 'voice' || channel.vendor !== 'vapi') {
      throw new BadRequestException(`channel ${input.channelId} is not a voice:vapi channel`);
    }
    const prev = jsonbToStored(channel.config);
    const merged: StoredVapiConfig = {
      encryptedApiKey: input.config?.apiKey
        ? await encryptString(input.config.apiKey)
        : prev.encryptedApiKey,
      encryptedWebhookSecret: input.config?.webhookSecret
        ? await encryptString(input.config.webhookSecret)
        : prev.encryptedWebhookSecret,
      assistantId: input.config?.assistantId ?? prev.assistantId,
      phoneNumberId: input.config?.phoneNumberId ?? prev.phoneNumberId,
      publicKey: input.config?.publicKey ?? prev.publicKey,
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

  private async toStored(input: VapiConfigInput): Promise<StoredVapiConfig> {
    return {
      encryptedApiKey: await encryptString(input.apiKey),
      encryptedWebhookSecret: await encryptString(input.webhookSecret),
      assistantId: input.assistantId,
      phoneNumberId: input.phoneNumberId,
      publicKey: input.publicKey,
    };
  }

  private toDto(id: string, name: string, active: boolean, stored: StoredVapiConfig): VapiChannelDto {
    return {
      id,
      name,
      type: 'voice',
      vendor: 'vapi',
      active,
      config: {
        apiKey: REDACTED,
        webhookSecret: REDACTED,
        assistantId: stored.assistantId,
        phoneNumberId: stored.phoneNumberId ?? null,
        publicKey: stored.publicKey ?? null,
      },
    };
  }
}

export function storedToJsonb(stored: StoredVapiConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

export function jsonbToStored(json: Record<string, unknown>): StoredVapiConfig {
  return StoredVapiConfigSchema.parse(json);
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
