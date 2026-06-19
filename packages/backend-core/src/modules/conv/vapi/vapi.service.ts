import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { sql, and, eq } from 'drizzle-orm';
import {
  encryptSecretSql,
  getCurrentContext,
  readApiBaseUrl,
} from '@getmunin/core';
import { schema, makeId, type Db } from '@getmunin/db';
import { z } from 'zod';
import { DB } from '../../../common/db/db.module.ts';
import { asRecord } from '../channels/json-shape.ts';
import { VapiClientService, VAPI_WEBHOOK_SECRET_HEADER } from './vapi-client.service.ts';

const REDACTED = '••••';

export const StoredVapiConfigSchema = z.object({
  encryptedApiKey: z.string().min(1),
  encryptedWebhookSecret: z.string().min(1),
  assistantId: z.string().min(1).max(128),
  phoneNumberId: z.string().min(1).max(128).optional(),
  publicKey: z.string().min(1).max(256).optional(),
  managedWebhook: z.boolean().optional(),
  priorAssistantServer: z.unknown().optional(),
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
  webhookConfigured?: boolean;
}

@Injectable()
export class VapiService {
  private readonly logger = new Logger(VapiService.name);

  constructor(
    @Inject(DB) private readonly _db: Db,
    @Inject(VapiClientService) private readonly client: VapiClientService,
  ) {}

  async createChannel(input: {
    name: string;
    config: VapiConfigInput;
    replaceWebhook?: boolean;
  }): Promise<VapiChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const channelId = makeId('cch');
    const auto = await this.tryConfigureAssistantWebhook(
      input.config,
      buildWebhookUrl(channelId),
      input.replaceWebhook ?? false,
    );
    if (auto.conflict) {
      throw new ConflictException({
        code: 'webhook_conflict',
        message:
          'This Vapi assistant already has a server URL configured. Replace it to connect this channel.',
      });
    }
    const stored = await this.toStored(input.config, auto);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        id: channelId,
        orgId: actor.orgId,
        type: 'voice',
        vendor: 'vapi',
        name: input.name,
        config: storedToJsonb(stored),
      })
      .returning();
    if (!row) throw new ConflictException('channel_create_failed');
    return this.toDto(row.id, row.name, row.active, stored, auto.configured);
  }

  private async tryConfigureAssistantWebhook(
    config: VapiConfigInput,
    webhookUrl: string,
    replaceWebhook: boolean,
  ): Promise<{ configured: boolean; priorServer: unknown; conflict: boolean }> {
    try {
      const fetched = await this.client.fetchAssistantConfig({
        apiKey: config.apiKey,
        assistantId: config.assistantId,
      });
      if (!fetched.ok) return { configured: false, priorServer: undefined, conflict: false };
      const priorServer = asRecord(fetched.config).server;
      const prior = asRecord(priorServer);
      const currentUrl = typeof prior.url === 'string' ? prior.url : '';
      if (currentUrl && !isMuninWebhookUrl(currentUrl) && !replaceWebhook) {
        return { configured: false, priorServer: undefined, conflict: true };
      }
      const patched = await this.client.updateAssistantServer({
        apiKey: config.apiKey,
        assistantId: config.assistantId,
        server: {
          ...prior,
          url: webhookUrl,
          headers: { ...asRecord(prior.headers), [VAPI_WEBHOOK_SECRET_HEADER]: config.webhookSecret },
        },
      });
      if (!patched.ok) return { configured: false, priorServer: undefined, conflict: false };
      return { configured: true, priorServer: priorServer ?? null, conflict: false };
    } catch (err) {
      this.logger.warn(
        `vapi assistant webhook auto-config failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { configured: false, priorServer: undefined, conflict: false };
    }
  }

  async restoreAssistantServer(channelId: string): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [channel] = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, actor.orgId)))
      .limit(1);
    if (!channel || channel.vendor !== 'vapi') return;
    const config = jsonbToStored(channel.config);
    if (!config.managedWebhook) return;
    const apiKey = await this.client.loadSecret(config.encryptedApiKey);
    await this.client.updateAssistantServer({
      apiKey,
      assistantId: config.assistantId,
      server: (config.priorAssistantServer ?? null) as Record<string, unknown> | null,
    });
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
      managedWebhook: prev.managedWebhook,
      priorAssistantServer: prev.priorAssistantServer,
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
    input: VapiConfigInput,
    auto?: { configured: boolean; priorServer: unknown },
  ): Promise<StoredVapiConfig> {
    return {
      encryptedApiKey: await encryptString(input.apiKey),
      encryptedWebhookSecret: await encryptString(input.webhookSecret),
      assistantId: input.assistantId,
      phoneNumberId: input.phoneNumberId,
      publicKey: input.publicKey,
      managedWebhook: auto?.configured ? true : undefined,
      priorAssistantServer: auto?.configured ? (auto.priorServer ?? null) : undefined,
    };
  }

  private toDto(
    id: string,
    name: string,
    active: boolean,
    stored: StoredVapiConfig,
    webhookConfigured?: boolean,
  ): VapiChannelDto {
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
      ...(webhookConfigured === undefined ? {} : { webhookConfigured }),
    };
  }
}

function buildWebhookUrl(channelId: string): string {
  return `${readApiBaseUrl()}/v1/conversations/channels/${channelId}/webhook`;
}

function isMuninWebhookUrl(url: string): boolean {
  const base = readApiBaseUrl();
  return url.startsWith(`${base}/v1/conversations/channels/`) && url.endsWith('/webhook');
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
