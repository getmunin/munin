import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { encryptSecretSql, getCurrentContext } from '@getmunin/core';
import type { AgentMode } from '@getmunin/types';
import { schema } from '@getmunin/db';
import { z } from 'zod';
import { readPendingSetup } from '../channels/channel-admin.ts';
import { parseStoredConfig } from '../channels/stored-config.ts';
import {
  DEFAULT_GRAPH_API_VERSION,
  MetaGraphClientService,
  buildWhatsAppWebhookUrl,
  deriveVerifyToken,
  type MetaAuth,
} from './meta-graph-client.service.ts';

const REDACTED = '••••';

const GraphApiVersionSchema = z
  .string()
  .regex(/^v\d{1,3}\.\d{1,2}$/, 'must look like v23.0');

export const StoredMetaWhatsAppConfigSchema = z.object({
  wabaId: z.string().min(1).max(64),
  phoneNumberId: z.string().min(1).max(64),
  graphApiVersion: GraphApiVersionSchema,
  encryptedAccessToken: z.string().min(1),
  encryptedAppSecret: z.string().min(1),
  displayPhoneNumber: z.string().max(64).optional(),
  verifiedName: z.string().max(256).optional(),
});

export type StoredMetaWhatsAppConfig = z.infer<typeof StoredMetaWhatsAppConfigSchema>;

export const MetaWhatsAppConfigInputSchema = z.object({
  wabaId: z.string().min(1).max(64),
  phoneNumberId: z.string().min(1).max(64),
  graphApiVersion: GraphApiVersionSchema.optional(),
  accessToken: z.string().min(1).max(1024),
  appSecret: z.string().min(1).max(256),
});

export type MetaWhatsAppConfigInput = z.infer<typeof MetaWhatsAppConfigInputSchema>;

export interface MetaWhatsAppConfigDto {
  wabaId: string;
  phoneNumberId: string;
  graphApiVersion: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  accessToken: string;
  appSecret: string;
  webhookUrl: string;
  verifyToken: string | null;
}

export interface MetaWhatsAppChannelDto {
  id: string;
  name: string;
  type: 'whatsapp';
  vendor: 'meta';
  active: boolean;
  config: MetaWhatsAppConfigDto;
  defaultAgentMode: AgentMode;
}

type ConfigPatch = Partial<MetaWhatsAppConfigInput>;

@Injectable()
export class MetaWhatsAppService {
  constructor(@Inject(MetaGraphClientService) private readonly client: MetaGraphClientService) {}

  async createChannel(input: {
    name: string;
    config: MetaWhatsAppConfigInput;
    defaultAgentMode?: AgentMode;
  }): Promise<MetaWhatsAppChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: 'whatsapp',
        vendor: 'meta',
        name: input.name,
        config: {},
        active: false,
        ...(input.defaultAgentMode ? { defaultAgentMode: input.defaultAgentMode } : {}),
      })
      .returning();
    if (!row) throw new ConflictException('channel_create_failed');
    const stored = await this.connect(row.id, input.config);
    const [updated] = await ctx.db
      .update(schema.convChannels)
      .set({ config: storedToJsonb(stored), active: true, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, row.id))
      .returning();
    return this.toDto(updated!.id, updated!.name, updated!.active, stored, updated!.defaultAgentMode as AgentMode);
  }

  async updateChannel(input: {
    channelId: string;
    name?: string;
    config?: ConfigPatch;
    defaultAgentMode?: AgentMode;
  }): Promise<MetaWhatsAppChannelDto> {
    const ctx = getCurrentContext();
    const channel = await this.loadChannel(input.channelId);
    const prev = jsonbToStored(channel.config);
    const patch = input.config ?? {};
    const reconnect =
      patch.accessToken !== undefined ||
      patch.appSecret !== undefined ||
      (patch.wabaId !== undefined && patch.wabaId !== prev.wabaId) ||
      (patch.phoneNumberId !== undefined && patch.phoneNumberId !== prev.phoneNumberId) ||
      (patch.graphApiVersion !== undefined && patch.graphApiVersion !== prev.graphApiVersion);

    let stored: StoredMetaWhatsAppConfig = {
      ...prev,
      ...(patch.graphApiVersion ? { graphApiVersion: patch.graphApiVersion } : {}),
    };
    if (reconnect) {
      stored = await this.connect(input.channelId, {
        wabaId: patch.wabaId ?? prev.wabaId,
        phoneNumberId: patch.phoneNumberId ?? prev.phoneNumberId,
        graphApiVersion: patch.graphApiVersion ?? prev.graphApiVersion,
        accessToken: patch.accessToken ?? (await this.client.loadSecret(prev.encryptedAccessToken)),
        appSecret: patch.appSecret ?? (await this.client.loadSecret(prev.encryptedAppSecret)),
      });
    }
    const [row] = await ctx.db
      .update(schema.convChannels)
      .set({
        ...(input.name && { name: input.name }),
        ...(input.defaultAgentMode ? { defaultAgentMode: input.defaultAgentMode } : {}),
        config: storedToJsonb(stored),
        updatedAt: new Date(),
      })
      .where(eq(schema.convChannels.id, input.channelId))
      .returning();
    if (!row) throw new ConflictException('channel_update_failed');
    return this.toDto(row.id, row.name, row.active, stored, row.defaultAgentMode as AgentMode);
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
    if (!channel || channel.type !== 'whatsapp' || channel.vendor !== 'meta') {
      return { ok: false, error: 'channel no longer exists' };
    }
    const pending = readPendingSetup(channel.config);
    const base = pending ?? nonSecretParts(jsonbToStored(channel.config));
    const parsed = MetaWhatsAppConfigInputSchema.safeParse({ ...base, ...secrets });
    if (!parsed.success) {
      throw new BadRequestException(`conv_invalid: config for meta: ${flattenError(parsed.error)}`);
    }
    let stored: StoredMetaWhatsAppConfig;
    try {
      stored = await this.connect(channelId, parsed.data);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    await ctx.db
      .update(schema.convChannels)
      .set({ config: storedToJsonb(stored), active: true, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, channelId));
    return {
      ok: true,
      detail: `credentials saved; webhook registered for ${stored.displayPhoneNumber ?? stored.phoneNumberId}`,
    };
  }

  async authFor(stored: StoredMetaWhatsAppConfig): Promise<MetaAuth> {
    return {
      accessToken: await this.client.loadSecret(stored.encryptedAccessToken),
      graphApiVersion: stored.graphApiVersion,
    };
  }

  async loadChannel(channelId: string): Promise<typeof schema.convChannels.$inferSelect> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, actor.orgId)))
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new NotFoundException(`conv_not_found: channel ${channelId} not found`);
    if (channel.type !== 'whatsapp' || channel.vendor !== 'meta') {
      throw new BadRequestException(`conv_invalid: channel ${channelId} is not a whatsapp:meta channel`);
    }
    if (readPendingSetup(channel.config)) {
      throw new BadRequestException(
        'conv_invalid: channel is awaiting credentials — complete the credential link first',
      );
    }
    return channel;
  }

  private async connect(
    channelId: string,
    input: MetaWhatsAppConfigInput,
  ): Promise<StoredMetaWhatsAppConfig> {
    const auth: MetaAuth = {
      accessToken: input.accessToken,
      graphApiVersion: input.graphApiVersion ?? DEFAULT_GRAPH_API_VERSION,
    };
    const phone = await this.client.getPhoneNumber(auth, input.phoneNumberId);
    await this.client.subscribeApp(auth, input.wabaId);
    await this.client.setPhoneNumberWebhook(
      auth,
      input.phoneNumberId,
      buildWhatsAppWebhookUrl(channelId),
      deriveVerifyToken(channelId),
    );
    return {
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      graphApiVersion: auth.graphApiVersion,
      encryptedAccessToken: await encryptString(input.accessToken),
      encryptedAppSecret: await encryptString(input.appSecret),
      ...(phone.displayPhoneNumber ? { displayPhoneNumber: phone.displayPhoneNumber } : {}),
      ...(phone.verifiedName ? { verifiedName: phone.verifiedName } : {}),
    };
  }

  toDto(
    id: string,
    name: string,
    active: boolean,
    stored: StoredMetaWhatsAppConfig,
    defaultAgentMode: AgentMode,
  ): MetaWhatsAppChannelDto {
    return {
      id,
      name,
      type: 'whatsapp',
      vendor: 'meta',
      active,
      defaultAgentMode,
      config: {
        wabaId: stored.wabaId,
        phoneNumberId: stored.phoneNumberId,
        graphApiVersion: stored.graphApiVersion,
        displayPhoneNumber: stored.displayPhoneNumber ?? null,
        verifiedName: stored.verifiedName ?? null,
        accessToken: REDACTED,
        appSecret: REDACTED,
        webhookUrl: buildWhatsAppWebhookUrl(id),
        verifyToken: safeVerifyToken(id),
      },
    };
  }
}

function safeVerifyToken(channelId: string): string | null {
  try {
    return deriveVerifyToken(channelId);
  } catch {
    return null;
  }
}

function nonSecretParts(stored: StoredMetaWhatsAppConfig): Record<string, unknown> {
  return {
    wabaId: stored.wabaId,
    phoneNumberId: stored.phoneNumberId,
    graphApiVersion: stored.graphApiVersion,
  };
}

function flattenError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

export function storedToJsonb(stored: StoredMetaWhatsAppConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

export function jsonbToStored(json: Record<string, unknown>): StoredMetaWhatsAppConfig {
  return parseStoredConfig(StoredMetaWhatsAppConfigSchema, json, 'whatsapp:meta');
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
