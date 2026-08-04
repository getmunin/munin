import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  ActorIdentity,
  decryptSecretSql,
  encryptSecretSql,
  getCurrentContext,
  setEncryptionKeySql,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { schema, type Db, type Tx } from '@getmunin/db';
import { z } from 'zod';
import {
  RedditChannelConfigInput,
  SendLimitsSchema,
  type AgentMode,
  type RedditChannelConfigInputT,
  type SendLimits,
} from '@getmunin/types';
import { randomUUID } from 'node:crypto';
import { DB } from '../../../common/db/db.module.ts';
import { readPendingSetup } from '../channels/channel-admin.ts';
import { RedditClientService, type RedditCredentials } from './reddit-client.service.ts';
import {
  REDDIT_CONNECT_STATE_TTL_MS,
  REDDIT_OAUTH_SCOPES,
  buildRedditAuthorizeUrl,
  redditOAuthRedirectUri,
  signRedditConnectState,
  verifyRedditConnectState,
} from './reddit-oauth.ts';

export { RedditChannelConfigInput };
export type { RedditChannelConfigInputT };

const REDACTED_SECRET = '••••';

export interface RedditConnectUrlResult {
  url: string;
  redirectUri: string;
  expiresAt: string;
}

function readConnectStateSecret(): string {
  const secret = process.env.MUNIN_AUTH_SECRET;
  if (!secret) {
    throw new BadRequestException(
      'conv_invalid: MUNIN_AUTH_SECRET is not set — it signs the Reddit connect state',
    );
  }
  return secret;
}

export const REDDIT_CHANNEL_TYPE = 'chat' as const;
export const REDDIT_CHANNEL_VENDOR = 'reddit' as const;

export const DEFAULT_REDDIT_SEND_LIMITS: SendLimits = { perHourMax: 3, perDayMax: 15 };

export const StoredRedditChannelConfigSchema = z.object({
  clientId: z.string().min(1),
  encryptedClientSecret: z.string(),
  username: z.string().min(1),
  encryptedRefreshToken: z.string(),
  sendLimits: SendLimitsSchema.optional(),
});

export type StoredRedditChannelConfig = z.infer<typeof StoredRedditChannelConfigSchema>;

export interface RedditChannelConfigDto {
  clientId: string;
  clientSecret: typeof REDACTED_SECRET;
  username: string;
  connected: boolean;
  sendLimits?: SendLimits;
}

export interface RedditChannelDto {
  id: string;
  name: string;
  type: typeof REDDIT_CHANNEL_TYPE;
  vendor: typeof REDDIT_CHANNEL_VENDOR;
  active: boolean;
  config: RedditChannelConfigDto;
  defaultAgentMode: AgentMode;
}

export type RedditChannelConfigPatch = {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  sendLimits?: SendLimits;
};

@Injectable()
export class RedditService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RedditClientService) private readonly client: RedditClientService,
  ) {}

  async createChannel(input: {
    name: string;
    config: RedditChannelConfigInputT;
    defaultAgentMode?: AgentMode;
  }): Promise<RedditChannelDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const stored = await this.toStored(input.config);
    const [row] = await ctx.db
      .insert(schema.convChannels)
      .values({
        orgId: actor.orgId,
        type: REDDIT_CHANNEL_TYPE,
        vendor: REDDIT_CHANNEL_VENDOR,
        name: input.name,
        config: storedToJsonb(stored),
        active: !needsCredentials(stored),
        ...(input.defaultAgentMode ? { defaultAgentMode: input.defaultAgentMode } : {}),
      })
      .returning();
    if (!row) throw new ConflictException('conv_conflict: reddit channel create failed');
    return this.toDto(row.id, row.name, row.active, stored, row.defaultAgentMode as AgentMode);
  }

  async updateChannel(input: {
    channelId: string;
    name?: string;
    config?: RedditChannelConfigPatch;
    defaultAgentMode?: AgentMode;
  }): Promise<RedditChannelDto> {
    const ctx = getCurrentContext();
    const channel = await this.requireChannel(input.channelId);
    const prev = jsonbToStored(channel.config);
    const merged = await this.mergeConfig(prev, input.config ?? {});
    const [row] = await ctx.db
      .update(schema.convChannels)
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.defaultAgentMode ? { defaultAgentMode: input.defaultAgentMode } : {}),
        config: storedToJsonb(merged),
        ...(needsCredentials(prev) && !needsCredentials(merged) ? { active: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.convChannels.id, input.channelId))
      .returning();
    if (!row) throw new ConflictException('conv_conflict: reddit channel update failed');
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
      .where(
        and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, actor.orgId)),
      )
      .limit(1);
    if (!channel || channel.vendor !== REDDIT_CHANNEL_VENDOR) {
      return { ok: false, error: 'channel no longer exists' };
    }
    const pending = readPendingSetup(channel.config);
    const base = pending ?? nonSecretParts(jsonbToStored(channel.config));
    const parsed = RedditChannelConfigInput.safeParse({ ...base, ...secrets });
    if (!parsed.success) {
      throw new BadRequestException(
        `conv_invalid: config for reddit: ${flattenError(parsed.error)}`,
      );
    }
    const previous = pending ? null : jsonbToStored(channel.config);
    const stored = await this.toStored(parsed.data);
    const next: StoredRedditChannelConfig = {
      ...stored,
      encryptedRefreshToken: previous?.encryptedRefreshToken ?? '',
    };
    await ctx.db
      .update(schema.convChannels)
      .set({
        config: storedToJsonb(next),
        active: !needsCredentials(next),
        updatedAt: new Date(),
      })
      .where(eq(schema.convChannels.id, channelId));
    return {
      ok: true,
      detail: needsCredentials(next)
        ? 'client secret saved — connect the Reddit account to activate the channel'
        : 'credentials saved',
    };
  }

  async requireChannel(channelId: string): Promise<typeof schema.convChannels.$inferSelect> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(
        and(eq(schema.convChannels.id, channelId), eq(schema.convChannels.orgId, actor.orgId)),
      )
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new NotFoundException(`conv_not_found: channel ${channelId} not found`);
    if (channel.type !== REDDIT_CHANNEL_TYPE || channel.vendor !== REDDIT_CHANNEL_VENDOR) {
      throw new BadRequestException(
        `conv_invalid: channel ${channelId} is not a ${REDDIT_CHANNEL_TYPE}:${REDDIT_CHANNEL_VENDOR} channel`,
      );
    }
    if (readPendingSetup(channel.config)) {
      throw new BadRequestException(
        `conv_invalid: channel ${channelId} is awaiting credentials — complete the credential link first`,
      );
    }
    return channel;
  }

  connectUrl(channelId: string, stored: StoredRedditChannelConfig): RedditConnectUrlResult {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!stored.encryptedClientSecret) {
      throw new BadRequestException(
        'conv_invalid: reddit channel has no client secret yet — enter it before connecting the account',
      );
    }
    const exp = Date.now() + REDDIT_CONNECT_STATE_TTL_MS;
    const state = signRedditConnectState(
      { orgId: actor.orgId, channelId, exp },
      readConnectStateSecret(),
    );
    return {
      url: buildRedditAuthorizeUrl({ clientId: stored.clientId, state }),
      redirectUri: redditOAuthRedirectUri(),
      expiresAt: new Date(exp).toISOString(),
    };
  }

  async completeOAuth(input: { code: string; state: string }): Promise<{ orgId: string }> {
    const state = verifyRedditConnectState(input.state, readConnectStateSecret());
    if (!state) throw new BadRequestException('conv_invalid: reddit_invalid_state');

    const actor = new ActorIdentity('system', 'reddit-oauth', state.orgId, ['*'], ['admin']);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const requestCtx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(requestCtx, async () => {
        const rows = await tx
          .select()
          .from(schema.convChannels)
          .where(
            and(
              eq(schema.convChannels.id, state.channelId),
              eq(schema.convChannels.orgId, state.orgId),
              eq(schema.convChannels.vendor, REDDIT_CHANNEL_VENDOR),
              isNull(schema.convChannels.archivedAt),
            ),
          )
          .limit(1);
        const channel = rows[0];
        if (!channel) throw new BadRequestException('conv_invalid: reddit_channel_missing');

        const stored = jsonbToStored(channel.config);
        const clientSecret = await decryptString(tx, stored.encryptedClientSecret);
        const exchanged = await this.client.exchangeAuthorizationCode({
          clientId: stored.clientId,
          clientSecret,
          code: input.code,
          redirectUri: redditOAuthRedirectUri(),
        });

        const authorized = await this.client.identityFromAccessToken(exchanged.accessToken);
        if (authorized.toLowerCase() !== stored.username.toLowerCase()) {
          throw new BadRequestException(
            `conv_invalid: reddit_account_mismatch: this channel is configured for u/${stored.username} ` +
              `but the authorization came from u/${authorized}`,
          );
        }

        const missing = REDDIT_OAUTH_SCOPES.filter((scope) => !exchanged.scopes.includes(scope));
        if (missing.length > 0) {
          throw new BadRequestException(
            `conv_invalid: reddit_missing_scopes: Reddit granted ${exchanged.scopes.join(', ') || 'nothing'} ` +
              `but this channel needs ${missing.join(', ')} as well`,
          );
        }

        const next: StoredRedditChannelConfig = {
          ...stored,
          encryptedRefreshToken: await encryptStringWith(tx, exchanged.refreshToken),
        };
        await tx
          .update(schema.convChannels)
          .set({ config: storedToJsonb(next), active: true, updatedAt: new Date() })
          .where(eq(schema.convChannels.id, channel.id));
        return { orgId: state.orgId };
      });
    });
  }

  async loadCredentials(
    channelId: string,
    stored: StoredRedditChannelConfig,
  ): Promise<RedditCredentials> {
    if (needsCredentials(stored)) {
      throw new BadRequestException(
        'conv_invalid: reddit channel has no stored credentials yet — complete the credential link first',
      );
    }
    return this.db.transaction(async (tx) => ({
      cacheKey: channelId,
      clientId: stored.clientId,
      clientSecret: await decryptString(tx, stored.encryptedClientSecret),
      username: stored.username,
      refreshToken: await decryptString(tx, stored.encryptedRefreshToken),
    }));
  }

  async toStored(input: RedditChannelConfigInputT): Promise<StoredRedditChannelConfig> {
    return {
      clientId: input.clientId,
      encryptedClientSecret: input.clientSecret ? await encryptString(input.clientSecret) : '',
      username: input.username,
      encryptedRefreshToken: '',
      sendLimits: trimSendLimits(input.sendLimits) ?? { ...DEFAULT_REDDIT_SEND_LIMITS },
    };
  }

  private async mergeConfig(
    prev: StoredRedditChannelConfig,
    patch: RedditChannelConfigPatch,
  ): Promise<StoredRedditChannelConfig> {
    return {
      clientId: patch.clientId ?? prev.clientId,
      encryptedClientSecret: patch.clientSecret
        ? await encryptString(patch.clientSecret)
        : prev.encryptedClientSecret,
      username: patch.username ?? prev.username,
      encryptedRefreshToken: prev.encryptedRefreshToken,
      sendLimits: trimSendLimits(patch.sendLimits) ?? prev.sendLimits,
    };
  }

  toDto(
    id: string,
    name: string,
    active: boolean,
    stored: StoredRedditChannelConfig,
    defaultAgentMode: AgentMode,
  ): RedditChannelDto {
    return {
      id,
      name,
      type: REDDIT_CHANNEL_TYPE,
      vendor: REDDIT_CHANNEL_VENDOR,
      active,
      defaultAgentMode,
      config: {
        clientId: stored.clientId,
        clientSecret: REDACTED_SECRET,
        username: stored.username,
        connected: Boolean(stored.encryptedRefreshToken),
        ...(stored.sendLimits ? { sendLimits: { ...stored.sendLimits } } : {}),
      },
    };
  }
}

export function publicChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const parsed = StoredRedditChannelConfigSchema.safeParse(config);
  if (!parsed.success) return {};
  const stored = parsed.data;
  return {
    clientId: stored.clientId,
    username: stored.username,
    connected: Boolean(stored.encryptedRefreshToken),
    ...(stored.sendLimits ? { sendLimits: stored.sendLimits } : {}),
  };
}

export function needsCredentials(stored: StoredRedditChannelConfig): boolean {
  return !stored.encryptedClientSecret || !stored.encryptedRefreshToken;
}

export function storedToJsonb(stored: StoredRedditChannelConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
}

export function jsonbToStored(json: Record<string, unknown>): StoredRedditChannelConfig {
  return StoredRedditChannelConfigSchema.parse(json);
}

function nonSecretParts(stored: StoredRedditChannelConfig): Record<string, unknown> {
  return {
    clientId: stored.clientId,
    username: stored.username,
    ...(stored.sendLimits ? { sendLimits: stored.sendLimits } : {}),
  };
}

function trimSendLimits(limits: SendLimits | undefined): SendLimits | null {
  if (!limits) return null;
  const out: SendLimits = {};
  if (limits.perHourMax !== undefined) out.perHourMax = limits.perHourMax;
  if (limits.perDayMax !== undefined) out.perDayMax = limits.perDayMax;
  return Object.keys(out).length > 0 ? out : null;
}

function flattenError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

async function encryptString(plaintext: string): Promise<string> {
  const ctx = getCurrentContext();
  const rows = await ctx.db.execute<{ ct: string } & Record<string, unknown>>(
    sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
  );
  const ct = rows[0]?.ct;
  if (!ct) throw new ConflictException('conv_conflict: encryption_failed');
  return ct;
}

async function encryptStringWith(tx: Db | Tx, plaintext: string): Promise<string> {
  const rows = await tx.execute<{ ct: string } & Record<string, unknown>>(
    sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
  );
  const ct = rows[0]?.ct;
  if (!ct) throw new ConflictException('conv_conflict: encryption_failed');
  return ct;
}

async function decryptString(tx: Db | Tx, ciphertext: string): Promise<string> {
  await tx.execute(setEncryptionKeySql());
  const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
    sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
  );
  const pt = rows[0]?.pt;
  if (pt === undefined || pt === null) {
    throw new ConflictException('conv_conflict: reddit_credential_decrypt_failed');
  }
  return pt;
}
