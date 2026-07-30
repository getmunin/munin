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
import type { AgentMode } from '@getmunin/types';
import { schema, type Db } from '@getmunin/db';
import { z } from 'zod';
import { DB } from '../../../common/db/db.module.ts';
import { readPendingSetup } from '../channels/channel-admin.ts';

const REDACTED = '••••';

export const StoredTwilioSmsConfigSchema = z.object({
  accountSid: z.string().min(2).max(64),
  encryptedAuthToken: z.string().min(1),
  fromNumber: z.string().min(2).max(32).optional(),
  messagingServiceSid: z.string().min(2).max(64).optional(),
});

export type StoredTwilioSmsConfig = z.infer<typeof StoredTwilioSmsConfigSchema>;

export const TwilioSmsConfigInputSchema = z
  .object({
    accountSid: z.string().min(2).max(64),
    authToken: z.string().min(1).max(256),
    fromNumber: z.string().min(2).max(32).optional(),
    messagingServiceSid: z.string().min(2).max(64).optional(),
  })
  .refine((v) => Boolean(v.fromNumber || v.messagingServiceSid), {
    message: 'either fromNumber or messagingServiceSid is required',
  });

export type TwilioSmsConfigInput = z.infer<typeof TwilioSmsConfigInputSchema>;

export interface TwilioSmsConfigDto {
  accountSid: string;
  authToken: string;
  fromNumber: string | null;
  messagingServiceSid: string | null;
}

export interface TwilioSmsChannelDto {
  id: string;
  name: string;
  type: 'sms';
  vendor: 'twilio';
  active: boolean;
  config: TwilioSmsConfigDto;
  defaultAgentMode: AgentMode;
}

@Injectable()
export class TwilioSmsService {
  constructor(@Inject(DB) private readonly _db: Db) {}

  async createChannel(input: {
    name: string;
    config: TwilioSmsConfigInput;
    defaultAgentMode?: AgentMode;
  }): Promise<TwilioSmsChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const stored = await this.toStored(input.config);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'sms',
        vendor: 'twilio',
        name: input.name,
        config: storedToJsonb(stored),
        ...(input.defaultAgentMode ? { defaultAgentMode: input.defaultAgentMode } : {}),
      })
      .returning();
    if (!row) throw new ConflictException('channel_create_failed');
    return this.toDto(row.id, row.name, row.active, stored, row.defaultAgentMode as AgentMode);
  }

  async updateChannel(input: {
    channelId: string;
    name?: string;
    config?: Partial<TwilioSmsConfigInput>;
    defaultAgentMode?: AgentMode;
  }): Promise<TwilioSmsChannelDto> {
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
    if (channel.type !== 'sms' || channel.vendor !== 'twilio') {
      throw new BadRequestException(`channel ${input.channelId} is not an sms:twilio channel`);
    }
    const prev = jsonbToStored(channel.config);
    const merged: StoredTwilioSmsConfig = {
      accountSid: input.config?.accountSid ?? prev.accountSid,
      encryptedAuthToken: input.config?.authToken
        ? await encryptString(input.config.authToken)
        : prev.encryptedAuthToken,
      fromNumber: input.config?.fromNumber ?? prev.fromNumber,
      messagingServiceSid: input.config?.messagingServiceSid ?? prev.messagingServiceSid,
    };
    if (!merged.fromNumber && !merged.messagingServiceSid) {
      throw new BadRequestException('either fromNumber or messagingServiceSid is required');
    }
    const [row] = await ctx.db
      .update(schema.convChannels)
      .set({
        ...(input.name && { name: input.name }),
        ...(input.defaultAgentMode ? { defaultAgentMode: input.defaultAgentMode } : {}),
        config: storedToJsonb(merged),
        updatedAt: new Date(),
      })
      .where(eq(schema.convChannels.id, input.channelId))
      .returning();
    if (!row) throw new ConflictException('channel_update_failed');
    return this.toDto(row.id, row.name, row.active, merged, row.defaultAgentMode as AgentMode);
  }

  async rotateAuthToken(input: { channelId: string; authToken: string }): Promise<TwilioSmsChannelDto> {
    return this.updateChannel({ channelId: input.channelId, config: { authToken: input.authToken } });
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
    if (!channel || channel.vendor !== 'twilio') {
      return { ok: false, error: 'channel no longer exists' };
    }
    const pending = readPendingSetup(channel.config);
    const base = pending ?? nonSecretParts(jsonbToStored(channel.config));
    const parsed = TwilioSmsConfigInputSchema.safeParse({ ...base, ...secrets });
    if (!parsed.success) {
      throw new BadRequestException(`conv_invalid: config for twilio: ${flattenError(parsed.error)}`);
    }
    const stored = await this.toStored(parsed.data);
    await ctx.db
      .update(schema.convChannels)
      .set({ config: storedToJsonb(stored), active: true, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, channelId));
    return { ok: true, detail: 'credentials saved' };
  }

  private async toStored(input: TwilioSmsConfigInput): Promise<StoredTwilioSmsConfig> {
    return {
      accountSid: input.accountSid,
      encryptedAuthToken: await encryptString(input.authToken),
      fromNumber: input.fromNumber,
      messagingServiceSid: input.messagingServiceSid,
    };
  }

  private toDto(
    id: string,
    name: string,
    active: boolean,
    stored: StoredTwilioSmsConfig,
    defaultAgentMode: AgentMode,
  ): TwilioSmsChannelDto {
    return {
      id,
      name,
      type: 'sms',
      vendor: 'twilio',
      active,
      defaultAgentMode,
      config: {
        accountSid: stored.accountSid,
        authToken: REDACTED,
        fromNumber: stored.fromNumber ?? null,
        messagingServiceSid: stored.messagingServiceSid ?? null,
      },
    };
  }
}

function nonSecretParts(stored: StoredTwilioSmsConfig): Record<string, unknown> {
  return { accountSid: stored.accountSid, fromNumber: stored.fromNumber, messagingServiceSid: stored.messagingServiceSid };
}

function flattenError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

export function storedToJsonb(stored: StoredTwilioSmsConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

export function jsonbToStored(json: Record<string, unknown>): StoredTwilioSmsConfig {
  return StoredTwilioSmsConfigSchema.parse(json);
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
