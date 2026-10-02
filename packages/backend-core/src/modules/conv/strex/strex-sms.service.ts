import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { sql, and, eq } from 'drizzle-orm';
import { encryptSecretSql, getCurrentContext } from '@getmunin/core';
import {
  STREX_KEYWORD,
  STREX_SHORT_NUMBER_ID,
  StrexEnvironmentSchema,
  type AgentMode,
  type StrexEnvironment,
} from '@getmunin/types';
import { schema, makeId, type Db } from '@getmunin/db';
import { z } from 'zod';
import { DB } from '../../../common/db/db.module.ts';
import { readPendingSetup } from '../channels/channel-admin.ts';
import { parseStoredConfig } from '../channels/stored-config.ts';
import {
  StrexClientService,
  buildStrexWebhookUrl,
  type StrexCredentials,
  type StrexKeywordInput,
} from './strex-client.service.ts';

const REDACTED = '••••';

const CATCH_ALL_KEYWORD = '*';

export const StoredStrexSmsConfigSchema = z.object({
  encryptedApiKey: z.string().min(1),
  sender: z.string().min(1).max(15),
  environment: StrexEnvironmentSchema,
  shortNumberId: z.string().regex(STREX_SHORT_NUMBER_ID).optional(),
  keyword: z.string().regex(STREX_KEYWORD).optional(),
  keywordId: z.string().min(1).optional(),
});

export type StoredStrexSmsConfig = z.infer<typeof StoredStrexSmsConfigSchema>;

export const StrexSmsConfigInputSchema = z.object({
  apiKey: z.string().min(1).max(512),
  sender: z.string().min(1).max(15),
  environment: StrexEnvironmentSchema.default('production'),
  shortNumberId: z.string().regex(STREX_SHORT_NUMBER_ID).optional(),
  keyword: z.string().regex(STREX_KEYWORD).optional(),
});

export type StrexSmsConfigInput = z.input<typeof StrexSmsConfigInputSchema>;

export interface StrexSmsConfigDto {
  apiKey: string;
  sender: string;
  environment: StrexEnvironment;
  shortNumberId: string | null;
  keyword: string | null;
  inboundKeywordId: string | null;
}

export interface StrexSmsChannelDto {
  id: string;
  name: string;
  type: 'sms';
  vendor: 'strex';
  active: boolean;
  config: StrexSmsConfigDto;
  defaultAgentMode: AgentMode;
}

interface InboundRouting {
  environment: StrexEnvironment;
  shortNumberId?: string;
  keyword?: string;
}

@Injectable()
export class StrexSmsService {
  private readonly logger = new Logger(StrexSmsService.name);

  constructor(
    @Inject(DB) private readonly _db: Db,
    @Inject(StrexClientService) private readonly client: StrexClientService,
  ) {}

  async createChannel(input: {
    name: string;
    config: StrexSmsConfigInput;
    defaultAgentMode?: AgentMode;
  }): Promise<StrexSmsChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const config = parseInput(input.config);
    const channelId = makeId('cch');
    const keywordId = await this.ensureKeyword(
      { apiKey: config.apiKey, environment: config.environment },
      config,
      buildStrexWebhookUrl(channelId),
    );
    const stored = await this.toStored(config, keywordId);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        id: channelId,
        orgId: actor.orgId,
        type: 'sms',
        vendor: 'strex',
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
    config?: {
      apiKey?: string;
      sender?: string;
      environment?: StrexEnvironment;
      shortNumberId?: string | null;
      keyword?: string | null;
    };
    defaultAgentMode?: AgentMode;
  }): Promise<StrexSmsChannelDto> {
    const ctx = getCurrentContext();
    const channel = await this.loadOwnChannel(input.channelId);
    const prev = jsonbToStored(channel.config);
    const patch = input.config ?? {};
    const next: InboundRouting = {
      environment: patch.environment ?? prev.environment,
      shortNumberId: resolveNullable(patch.shortNumberId, prev.shortNumberId),
      keyword: resolveNullable(patch.keyword, prev.keyword),
    };
    const prevApiKey = await this.client.loadSecret(prev.encryptedApiKey);
    const nextCreds: StrexCredentials = {
      apiKey: patch.apiKey ?? prevApiKey,
      environment: next.environment,
    };

    let keywordId = prev.keywordId;
    const routingChanged = routingKey(next) !== routingKey(prev);
    if (routingChanged || (next.shortNumberId && !keywordId)) {
      keywordId = next.shortNumberId
        ? await this.ensureKeyword(nextCreds, next, buildStrexWebhookUrl(input.channelId))
        : undefined;
      if (prev.keywordId && prev.keywordId !== keywordId) {
        await this.removeKeyword(
          { apiKey: prevApiKey, environment: prev.environment },
          prev.keywordId,
          input.channelId,
        );
      }
    }

    const merged: StoredStrexSmsConfig = {
      encryptedApiKey: patch.apiKey ? await encryptString(patch.apiKey) : prev.encryptedApiKey,
      sender: patch.sender ?? prev.sender,
      environment: next.environment,
      ...(next.shortNumberId ? { shortNumberId: next.shortNumberId } : {}),
      ...(next.keyword ? { keyword: next.keyword } : {}),
      ...(keywordId ? { keywordId } : {}),
    };
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
    if (!channel || channel.vendor !== 'strex') {
      return { ok: false, error: 'channel no longer exists' };
    }
    const pending = readPendingSetup(channel.config);
    const base = pending ?? nonSecretParts(jsonbToStored(channel.config));
    const parsed = StrexSmsConfigInputSchema.safeParse({ ...base, ...secrets });
    if (!parsed.success) {
      throw new BadRequestException(`conv_invalid: config for strex: ${flattenError(parsed.error)}`);
    }
    const config = parsed.data;
    const keywordId = await this.ensureKeyword(
      { apiKey: config.apiKey, environment: config.environment },
      config,
      buildStrexWebhookUrl(channelId),
    );
    const stored = await this.toStored(config, keywordId);
    await ctx.db
      .update(schema.convChannels)
      .set({ config: storedToJsonb(stored), active: true, updatedAt: new Date() })
      .where(eq(schema.convChannels.id, channelId));
    return {
      ok: true,
      detail: keywordId
        ? 'credentials saved; inbound keyword registered with Strex'
        : 'credentials saved; outbound only (no shortNumberId)',
    };
  }

  async removeInboundKeyword(channelId: string): Promise<void> {
    const channel = await this.loadOwnChannel(channelId);
    if (readPendingSetup(channel.config)) return;
    const stored = jsonbToStored(channel.config);
    if (!stored.keywordId) return;
    const apiKey = await this.client.loadSecret(stored.encryptedApiKey);
    await this.client.deleteKeyword({ apiKey, environment: stored.environment }, stored.keywordId);
  }

  private async ensureKeyword(
    creds: StrexCredentials,
    routing: InboundRouting,
    webhookUrl: string,
  ): Promise<string | undefined> {
    if (!routing.shortNumberId) return undefined;
    const wanted = keywordInput(routing.shortNumberId, routing.keyword, webhookUrl);
    const existing = await this.client
      .listKeywords(creds, { shortNumberId: wanted.shortNumberId, keywordText: wanted.keywordText })
      .catch((err: unknown) => {
        throw new BadRequestException(`strex_keyword_lookup_failed: ${describe(err)}`);
      });
    const sameText = existing.filter(
      (k) => k.keywordText.toLowerCase() === wanted.keywordText.toLowerCase(),
    );
    const ours = sameText.find((k) => forwardsTo(k.forwardUrl, webhookUrl));
    if (ours) return ours.keywordId;
    if (sameText.length > 0) {
      throw new ConflictException({
        message: `strex_keyword_conflict: keyword '${wanted.keywordText}' on ${wanted.shortNumberId} already forwards elsewhere — remove it in Strex Connect or pick another keyword`,
        code: 'strex_keyword_conflict',
      });
    }
    try {
      return await this.client.createKeyword(creds, wanted);
    } catch (err) {
      throw new BadRequestException(`strex_keyword_create_failed: ${describe(err)}`);
    }
  }

  private async removeKeyword(
    creds: StrexCredentials,
    keywordId: string,
    channelId: string,
  ): Promise<void> {
    try {
      await this.client.deleteKeyword(creds, keywordId);
    } catch (err) {
      this.logger.warn(
        `could not delete superseded Strex keyword ${keywordId} for channel ${channelId}: ${describe(err)}`,
      );
    }
  }

  private async loadOwnChannel(
    channelId: string,
  ): Promise<typeof schema.convChannels.$inferSelect> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, actor.orgId)))
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new NotFoundException(`channel ${channelId} not found`);
    if (channel.type !== 'sms' || channel.vendor !== 'strex') {
      throw new BadRequestException(`channel ${channelId} is not an sms:strex channel`);
    }
    return channel;
  }

  private async toStored(
    input: z.output<typeof StrexSmsConfigInputSchema>,
    keywordId: string | undefined,
  ): Promise<StoredStrexSmsConfig> {
    return {
      encryptedApiKey: await encryptString(input.apiKey),
      sender: input.sender,
      environment: input.environment,
      ...(input.shortNumberId ? { shortNumberId: input.shortNumberId } : {}),
      ...(input.keyword ? { keyword: input.keyword } : {}),
      ...(keywordId ? { keywordId } : {}),
    };
  }

  private toDto(
    id: string,
    name: string,
    active: boolean,
    stored: StoredStrexSmsConfig,
    defaultAgentMode: AgentMode,
  ): StrexSmsChannelDto {
    return {
      id,
      name,
      type: 'sms',
      vendor: 'strex',
      active,
      defaultAgentMode,
      config: {
        apiKey: REDACTED,
        sender: stored.sender,
        environment: stored.environment,
        shortNumberId: stored.shortNumberId ?? null,
        keyword: stored.keyword ?? null,
        inboundKeywordId: stored.keywordId ?? null,
      },
    };
  }
}

export function keywordInput(
  shortNumberId: string,
  keyword: string | undefined,
  forwardUrl: string,
): StrexKeywordInput {
  return keyword
    ? { shortNumberId, keywordText: keyword, mode: 'Exact', forwardUrl }
    : { shortNumberId, keywordText: CATCH_ALL_KEYWORD, mode: 'Wildcard', forwardUrl };
}

function forwardsTo(forwardUrl: string, webhookUrl: string): boolean {
  const target = webhookUrl.toLowerCase();
  return forwardUrl.split('|').some((u) => u.trim().toLowerCase() === target);
}

function routingKey(r: InboundRouting): string {
  return `${r.environment}|${r.shortNumberId ?? ''}|${r.keyword ?? ''}`;
}

function resolveNullable<T>(patch: T | null | undefined, prev: T | undefined): T | undefined {
  if (patch === null) return undefined;
  return patch ?? prev;
}

function parseInput(input: StrexSmsConfigInput): z.output<typeof StrexSmsConfigInputSchema> {
  const parsed = StrexSmsConfigInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException(`conv_invalid: config for strex: ${flattenError(parsed.error)}`);
  }
  return parsed.data;
}

function nonSecretParts(stored: StoredStrexSmsConfig): Record<string, unknown> {
  return {
    sender: stored.sender,
    environment: stored.environment,
    ...(stored.shortNumberId ? { shortNumberId: stored.shortNumberId } : {}),
    ...(stored.keyword ? { keyword: stored.keyword } : {}),
  };
}

function flattenError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function storedToJsonb(stored: StoredStrexSmsConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

export function jsonbToStored(json: Record<string, unknown>): StoredStrexSmsConfig {
  return parseStoredConfig(StoredStrexSmsConfigSchema, json, 'sms:strex');
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
