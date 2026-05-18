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

export const StoredMessageBirdSmsConfigSchema = z.object({
  encryptedAccessKey: z.string().min(1),
  encryptedSigningKey: z.string().min(1),
  originator: z.string().min(1).max(32),
});

export type StoredMessageBirdSmsConfig = z.infer<typeof StoredMessageBirdSmsConfigSchema>;

export const MessageBirdSmsConfigInputSchema = z.object({
  accessKey: z.string().min(1).max(256),
  signingKey: z.string().min(1).max(256),
  originator: z.string().min(1).max(32),
});

export type MessageBirdSmsConfigInput = z.infer<typeof MessageBirdSmsConfigInputSchema>;

export interface MessageBirdSmsConfigDto {
  accessKey: string;
  signingKey: string;
  originator: string;
}

export interface MessageBirdSmsChannelDto {
  id: string;
  name: string;
  type: 'sms';
  vendor: 'messagebird';
  active: boolean;
  config: MessageBirdSmsConfigDto;
}

@Injectable()
export class MessageBirdSmsService {
  constructor(@Inject(DB) private readonly _db: Db) {}

  async createChannel(input: {
    name: string;
    config: MessageBirdSmsConfigInput;
  }): Promise<MessageBirdSmsChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const stored = await this.toStored(input.config);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'sms',
        vendor: 'messagebird',
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
    config?: Partial<MessageBirdSmsConfigInput>;
  }): Promise<MessageBirdSmsChannelDto> {
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
    if (channel.type !== 'sms' || channel.vendor !== 'messagebird') {
      throw new BadRequestException(`channel ${input.channelId} is not an sms:messagebird channel`);
    }
    const prev = jsonbToStored(channel.config);
    const merged: StoredMessageBirdSmsConfig = {
      encryptedAccessKey: input.config?.accessKey
        ? await encryptString(input.config.accessKey)
        : prev.encryptedAccessKey,
      encryptedSigningKey: input.config?.signingKey
        ? await encryptString(input.config.signingKey)
        : prev.encryptedSigningKey,
      originator: input.config?.originator ?? prev.originator,
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

  private async toStored(input: MessageBirdSmsConfigInput): Promise<StoredMessageBirdSmsConfig> {
    return {
      encryptedAccessKey: await encryptString(input.accessKey),
      encryptedSigningKey: await encryptString(input.signingKey),
      originator: input.originator,
    };
  }

  private toDto(
    id: string,
    name: string,
    active: boolean,
    stored: StoredMessageBirdSmsConfig,
  ): MessageBirdSmsChannelDto {
    return {
      id,
      name,
      type: 'sms',
      vendor: 'messagebird',
      active,
      config: {
        accessKey: REDACTED,
        signingKey: REDACTED,
        originator: stored.originator,
      },
    };
  }
}

export function storedToJsonb(stored: StoredMessageBirdSmsConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

export function jsonbToStored(json: Record<string, unknown>): StoredMessageBirdSmsConfig {
  return StoredMessageBirdSmsConfigSchema.parse(json);
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
