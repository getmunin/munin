import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { makeId, schema, type Tx } from '@getmunin/db';
import {
  ActorIdentity,
  RequestContextStore,
  getCurrentContext,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { authorizationServerUrl } from '../../oauth/oauth.constants.ts';
import {
  OutboundOAuthStore,
  type RefreshOutcome,
} from '../../common/outbound-oauth/grant-store.ts';
import { accessTokenIsFresh } from '../../common/outbound-oauth/grant.ts';
import { readSignedState, signSignedState } from '../../common/outbound-oauth/signed-state.ts';
import { SingleFlight } from '../../common/outbound-oauth/single-flight.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import {
  SocialGrantRevokedError,
  SocialOAuthRegistry,
  type SocialOAuthAdapter,
  type SocialOAuthClient,
  type SocialTokenSet,
} from './social-oauth.ts';
import { isSocialPlatform, type SocialAuthorKind, type SocialPlatform } from './social-platform.ts';

const AUTHORIZE_STATE_TTL_MS = 10 * 60 * 1000;
export const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
export const SOCIAL_ALERT_SOURCE = 'social' as const;

export const SOCIAL_ACCOUNT_STATUSES = ['active', 'expired', 'revoked'] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export interface SocialAccountDto {
  id: string;
  platform: SocialPlatform;
  userId: string;
  authorKind: SocialAuthorKind;
  externalAccountId: string;
  displayName: string | null;
  status: SocialAccountStatus;
  scopes: string[];
  canRefresh: boolean;
  accessTokenExpiresAt: string | null;
  expiresSoon: boolean;
  lastError: string | null;
  connectedAt: string;
}

export interface SocialPlatformAppDto {
  platform: SocialPlatform;
  clientId: string;
  configured: boolean;
  redirectUri: string;
}

interface AuthorizeState {
  orgId: string;
  userId: string;
  platform: SocialPlatform;
  exp: number;
}

type AccountRow = typeof schema.socialAccounts.$inferSelect;

export function socialOAuthRedirectUri(): string {
  return `${authorizationServerUrl()}/v1/social/oauth/callback`;
}

function stateSecret(): string {
  const secret = process.env.MUNIN_AUTH_SECRET;
  if (!secret) {
    throw new BadRequestException(
      'social_invalid: MUNIN_AUTH_SECRET must be set to run a social authorization flow',
    );
  }
  return secret;
}

export function signSocialState(state: AuthorizeState): string {
  return signSignedState(state, stateSecret());
}

export function verifySocialState(raw: unknown): AuthorizeState | null {
  const state = readSignedState(raw, stateSecret());
  if (!state) return null;
  const orgId = state['orgId'];
  const userId = state['userId'];
  const platform = state['platform'];
  const exp = state['exp'];
  if (typeof orgId !== 'string' || typeof userId !== 'string') return null;
  if (typeof platform !== 'string' || !isSocialPlatform(platform)) return null;
  if (typeof exp !== 'number') return null;
  return { orgId, userId, platform, exp };
}

export function expiresSoon(
  row: { accessTokenExpiresAt: Date | null },
  windowMs: number = EXPIRY_WARNING_MS,
  now: number = Date.now(),
): boolean {
  if (!row.accessTokenExpiresAt) return false;
  return row.accessTokenExpiresAt.getTime() - windowMs <= now;
}

@Injectable()
export class SocialAccountsService {
  private readonly log = new Logger(SocialAccountsService.name);
  private readonly inFlight = new SingleFlight<string>();

  constructor(
    @Inject(SocialOAuthRegistry) private readonly registry: SocialOAuthRegistry,
    @Inject(OutboundOAuthStore) private readonly store: OutboundOAuthStore,
    @Inject(AlertsService) private readonly alerts: AlertsService,
  ) {}

  async setPlatformApp(input: {
    platform: SocialPlatform;
    clientId: string;
    clientSecret: string;
  }): Promise<SocialPlatformAppDto> {
    this.requireAdapter(input.platform);
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    return this.store.inRootTransaction(async (tx) => {
      const encrypted = await this.store.encrypt(tx, input.clientSecret);
      const [existing] = await tx
        .select({ id: schema.socialPlatformApps.id })
        .from(schema.socialPlatformApps)
        .where(
          and(
            eq(schema.socialPlatformApps.orgId, orgId),
            eq(schema.socialPlatformApps.platform, input.platform),
          ),
        )
        .limit(1);
      if (existing) {
        await tx
          .update(schema.socialPlatformApps)
          .set({
            clientId: input.clientId,
            encryptedClientSecret: encrypted,
            updatedAt: new Date(),
          })
          .where(eq(schema.socialPlatformApps.id, existing.id));
      } else {
        await tx.insert(schema.socialPlatformApps).values({
          id: makeId('spa'),
          orgId,
          platform: input.platform,
          clientId: input.clientId,
          encryptedClientSecret: encrypted,
        });
      }
      return {
        platform: input.platform,
        clientId: input.clientId,
        configured: true,
        redirectUri: socialOAuthRedirectUri(),
      };
    });
  }

  async listPlatformApps(): Promise<SocialPlatformAppDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        platform: schema.socialPlatformApps.platform,
        clientId: schema.socialPlatformApps.clientId,
      })
      .from(schema.socialPlatformApps)
      .where(eq(schema.socialPlatformApps.orgId, ctx.actor!.orgId));
    const configured = new Map(rows.map((r) => [r.platform, r.clientId]));
    const redirectUri = socialOAuthRedirectUri();
    return this.registry.platforms().map((platform) => ({
      platform,
      clientId: configured.get(platform) ?? '',
      configured: configured.has(platform),
      redirectUri,
    }));
  }

  async authorizeUrl(input: { platform: SocialPlatform }): Promise<{
    url: string;
    expiresAt: string;
  }> {
    const adapter = this.requireAdapter(input.platform);
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const userId = ctx.actor!.userId;
    if (!userId) {
      throw new BadRequestException(
        'social_invalid: a social account is connected by a signed-in person, not by a service key',
      );
    }
    const clientId = await this.store.inRootTransaction(async (tx) => {
      const client = await this.readClient(tx, orgId, input.platform, adapter);
      return client.clientId;
    });
    const exp = Date.now() + AUTHORIZE_STATE_TTL_MS;
    const state = signSocialState({ orgId, userId, platform: input.platform, exp });
    return {
      url: adapter.authorizeUrl({ state, redirectUri: socialOAuthRedirectUri(), clientId }),
      expiresAt: new Date(exp).toISOString(),
    };
  }

  async completeAuthorization(args: { code: string; state: string }): Promise<{
    orgId: string;
    platform: SocialPlatform;
    accountId: string;
  }> {
    const state = verifySocialState(args.state);
    if (!state) throw new BadRequestException('social_invalid_state');
    const adapter = this.requireAdapter(state.platform);
    return this.store.inRootTransaction(async (tx) => {
      const client = await this.readClient(tx, state.orgId, state.platform, adapter);
      let tokens: SocialTokenSet;
      try {
        tokens = await adapter.exchangeCode({
          code: args.code,
          redirectUri: socialOAuthRedirectUri(),
          client,
        });
      } catch (err) {
        throw new BadRequestException(
          `social_invalid: ${adapter.displayName} rejected the authorization code${
            err instanceof Error ? `: ${err.message}` : ''
          }`,
        );
      }
      const identity = await adapter.identify({ accessToken: tokens.accessToken });
      const accountId = await this.upsertAccount(tx, {
        orgId: state.orgId,
        userId: state.userId,
        platform: state.platform,
        identity,
        tokens,
        adapter,
      });
      await this.clearAlert(state.orgId, state.userId, state.platform);
      return { orgId: state.orgId, platform: state.platform, accountId };
    });
  }

  async listAccounts(): Promise<SocialAccountDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.orgId, ctx.actor!.orgId));
    return rows.map((row) => toAccountDto(row));
  }

  async disconnect(id: string): Promise<{ disconnected: true; id: string }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const [row] = await ctx.db
      .select({ id: schema.socialAccounts.id, userId: schema.socialAccounts.userId, platform: schema.socialAccounts.platform })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.orgId, orgId), eq(schema.socialAccounts.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException(`social_not_found: social account ${id} not found`);
    await ctx.db.delete(schema.socialAccounts).where(eq(schema.socialAccounts.id, row.id));
    await this.alerts.resolveAlert({
      source: SOCIAL_ALERT_SOURCE,
      subjectId: alertSubjectId(row.platform),
      userId: row.userId,
    });
    return { disconnected: true, id: row.id };
  }

  accessTokenFor(args: { userId: string; orgId: string; platform: SocialPlatform }): Promise<string> {
    return this.inFlight.run(`${args.orgId}:${args.userId}:${args.platform}`, () =>
      this.store.resolveOrMarkRevoked({
        attempt: () => this.resolveUnderLock(args),
        onRevoked: (reason) => this.markUnusable(args, reason),
        revokedError: (reason) =>
          new BadRequestException(
            `social_reconnect_required: this ${this.displayNameOf(args.platform)} connection can no longer post (${reason}) — reconnect it from the dashboard`,
          ),
      }),
    );
  }

  private async resolveUnderLock(args: {
    userId: string;
    orgId: string;
    platform: SocialPlatform;
  }): Promise<RefreshOutcome<string>> {
    const adapter = this.requireAdapter(args.platform);
    return this.store.inRootTransaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.socialAccounts)
        .where(
          and(
            eq(schema.socialAccounts.orgId, args.orgId),
            eq(schema.socialAccounts.userId, args.userId),
            eq(schema.socialAccounts.platform, args.platform),
          ),
        )
        .for('update')
        .limit(1);
      if (!row) {
        throw new NotFoundException(
          `social_not_found: no ${adapter.displayName} account is connected for this person`,
        );
      }
      if (row.status !== 'active') {
        return { revoked: row.lastError ?? `the connection is ${row.status}` };
      }
      if (accessTokenIsFresh(row)) {
        return { token: await this.store.decrypt(tx, row.encryptedAccessToken) };
      }
      if (!row.encryptedRefreshToken) {
        return {
          revoked: `${adapter.displayName} issued no refresh token, so the 60-day grant has run out`,
        };
      }
      const client = await this.readClient(tx, args.orgId, args.platform, adapter);
      const refreshToken = await this.store.decrypt(tx, row.encryptedRefreshToken);
      let tokens: SocialTokenSet;
      try {
        tokens = await adapter.refresh({ refreshToken, client });
      } catch (err) {
        if (err instanceof SocialGrantRevokedError) return { revoked: err.message };
        throw err;
      }
      await tx
        .update(schema.socialAccounts)
        .set({
          encryptedAccessToken: await this.store.encrypt(tx, tokens.accessToken),
          accessTokenExpiresAt: expiryFrom(tokens.expiresInSeconds),
          encryptedRefreshToken: tokens.refreshToken
            ? await this.store.encrypt(tx, tokens.refreshToken)
            : row.encryptedRefreshToken,
          refreshTokenExpiresAt:
            expiryFrom(tokens.refreshTokenExpiresInSeconds) ?? row.refreshTokenExpiresAt,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.socialAccounts.id, row.id));
      return { token: tokens.accessToken };
    });
  }

  private async markUnusable(
    args: { userId: string; orgId: string; platform: SocialPlatform },
    reason: string,
  ): Promise<void> {
    await this.store.inRootTransaction(async (tx) => {
      await tx
        .update(schema.socialAccounts)
        .set({ status: 'expired', lastError: reason, updatedAt: new Date() })
        .where(
          and(
            eq(schema.socialAccounts.orgId, args.orgId),
            eq(schema.socialAccounts.userId, args.userId),
            eq(schema.socialAccounts.platform, args.platform),
          ),
        );
    });
    await this.raiseReconnectAlert({ ...args, reason, severity: 'error' });
  }

  async raiseReconnectAlert(args: {
    orgId: string;
    userId: string;
    platform: SocialPlatform;
    reason: string;
    severity: 'warning' | 'error';
  }): Promise<void> {
    const displayName = this.displayNameOf(args.platform);
    await this.withOrgContext(args.orgId, async () => {
      await this.alerts.openAlert({
        source: SOCIAL_ALERT_SOURCE,
        subjectId: alertSubjectId(args.platform),
        userId: args.userId,
        severity: args.severity,
        title:
          args.severity === 'error'
            ? `Reconnect ${displayName}`
            : `${displayName} access expires soon`,
        detail: args.reason,
        metadata: { platform: args.platform },
        ctaHref: '/dashboard/settings/integrations',
        ctaLabelKey: 'alerts.cta.reconnectSocial',
      });
    });
  }

  private async clearAlert(
    orgId: string,
    userId: string,
    platform: SocialPlatform,
  ): Promise<void> {
    await this.withOrgContext(orgId, async () => {
      await this.alerts.resolveAlert({
        source: SOCIAL_ALERT_SOURCE,
        subjectId: alertSubjectId(platform),
        userId,
      });
    });
  }

  private async withOrgContext(orgId: string, fn: () => Promise<void>): Promise<void> {
    const current = RequestContextStore.getStore();
    if (current?.actor?.orgId === orgId) {
      await fn();
      return;
    }
    const actor = new ActorIdentity('system', 'social-accounts', orgId, ['*'], ['admin']);
    await this.store.inRootTransaction(async (tx) => {
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, fn);
    });
  }

  private async upsertAccount(
    tx: Tx,
    input: {
      orgId: string;
      userId: string;
      platform: SocialPlatform;
      identity: { externalAccountId: string; displayName: string | null };
      tokens: SocialTokenSet;
      adapter: SocialOAuthAdapter;
    },
  ): Promise<string> {
    const [existing] = await tx
      .select({ id: schema.socialAccounts.id })
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.orgId, input.orgId),
          eq(schema.socialAccounts.userId, input.userId),
          eq(schema.socialAccounts.platform, input.platform),
        ),
      )
      .limit(1);

    const [claimed] = await tx
      .select({ id: schema.socialAccounts.id, userId: schema.socialAccounts.userId })
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.orgId, input.orgId),
          eq(schema.socialAccounts.platform, input.platform),
          eq(schema.socialAccounts.externalAccountId, input.identity.externalAccountId),
        ),
      )
      .limit(1);
    if (claimed && claimed.userId !== input.userId) {
      throw new BadRequestException({
        message: `social_account_taken: that ${input.adapter.displayName} account is already connected by someone else in this organisation`,
        code: 'social_account_taken',
      });
    }

    const values = {
      orgId: input.orgId,
      userId: input.userId,
      platform: input.platform,
      externalAccountId: input.identity.externalAccountId,
      displayName: input.identity.displayName,
      encryptedAccessToken: await this.store.encrypt(tx, input.tokens.accessToken),
      accessTokenExpiresAt: expiryFrom(input.tokens.expiresInSeconds),
      encryptedRefreshToken: input.tokens.refreshToken
        ? await this.store.encrypt(tx, input.tokens.refreshToken)
        : null,
      refreshTokenExpiresAt: expiryFrom(input.tokens.refreshTokenExpiresInSeconds),
      scopes: [...(input.tokens.scopes ?? input.adapter.authorizationScopes)],
      status: 'active' as const,
      lastError: null,
    };

    if (existing) {
      await tx
        .update(schema.socialAccounts)
        .set({ ...values, connectedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.socialAccounts.id, existing.id));
      return existing.id;
    }
    const id = makeId('sac');
    await tx.insert(schema.socialAccounts).values({ id, ...values });
    return id;
  }

  private async readClient(
    tx: Tx,
    orgId: string,
    platform: SocialPlatform,
    adapter: SocialOAuthAdapter,
  ): Promise<SocialOAuthClient> {
    const [row] = await tx
      .select({
        clientId: schema.socialPlatformApps.clientId,
        encryptedClientSecret: schema.socialPlatformApps.encryptedClientSecret,
      })
      .from(schema.socialPlatformApps)
      .where(
        and(
          eq(schema.socialPlatformApps.orgId, orgId),
          eq(schema.socialPlatformApps.platform, platform),
        ),
      )
      .limit(1);
    if (!row) {
      throw new BadRequestException({
        message: `social_app_missing: enter this organisation's ${adapter.displayName} client id and secret before connecting an account`,
        code: 'social_app_missing',
      });
    }
    return {
      clientId: row.clientId,
      clientSecret: await this.store.decrypt(tx, row.encryptedClientSecret),
    };
  }

  private requireAdapter(platform: SocialPlatform): SocialOAuthAdapter {
    const adapter = this.registry.get(platform);
    if (!adapter) {
      throw new BadRequestException(
        `social_invalid: ${platform} cannot be connected — no authorization adapter is registered`,
      );
    }
    return adapter;
  }

  private displayNameOf(platform: SocialPlatform): string {
    return this.registry.get(platform)?.displayName ?? platform;
  }
}

function alertSubjectId(platform: string): string {
  return `social:${platform}`;
}

function expiryFrom(seconds: number | undefined): Date | null {
  return seconds ? new Date(Date.now() + seconds * 1000) : null;
}

export function toAccountDto(row: AccountRow): SocialAccountDto {
  return {
    id: row.id,
    platform: row.platform as SocialPlatform,
    userId: row.userId,
    authorKind: row.authorKind as SocialAuthorKind,
    externalAccountId: row.externalAccountId,
    displayName: row.displayName,
    status: row.status as SocialAccountStatus,
    scopes: row.scopes,
    canRefresh: row.encryptedRefreshToken !== null,
    accessTokenExpiresAt: row.accessTokenExpiresAt?.toISOString() ?? null,
    expiresSoon: expiresSoon(row),
    lastError: row.lastError,
    connectedAt: row.connectedAt.toISOString(),
  };
}
