import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import {
  decryptSecretSql,
  encryptSecretSql,
  getCurrentContext,
  setEncryptionKeySql,
  signHmac,
  verifyHmac,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { mcpResourceOrigin } from '../../oauth/oauth.constants.ts';
import { SlackApiClient, SlackApiError } from './slack-api.client.ts';
import { testMessageText } from './slack-projection.ts';
import { readSlackAppConfig, SLACK_BOT_SCOPES } from './slack.constants.ts';

const INSTALL_STATE_TTL_MS = 10 * 60 * 1000;

export interface SlackRouteDto {
  id: string;
  slackChannelId: string;
  slackChannelName: string | null;
  purpose: string;
  mention: string | null;
}

export interface SlackIntegrationDto {
  id: string;
  teamId: string;
  teamName: string | null;
  botUserId: string | null;
  active: boolean;
  installedByUserId: string | null;
  routes: SlackRouteDto[];
  createdAt: string;
  updatedAt: string;
}

export interface SlackStatusDto {
  /** Whether this deployment has a Slack app configured (env credentials). */
  appConfigured: boolean;
  connected: boolean;
  integration: SlackIntegrationDto | null;
  deliveries: { pending: number; failedLastDay: number };
}

export interface SetRoutingInput {
  slackChannelId: string;
  purpose?: 'default' | 'escalations';
  mention?: string | null;
}

interface InstallState {
  orgId: string;
  userId: string | null;
  exp: number;
}

export function slackOAuthRedirectUri(): string {
  return `${mcpResourceOrigin()}/v1/slack/oauth/callback`;
}

export async function encryptSecretValue(db: Db | Tx, plaintext: string): Promise<string> {
  return await db.transaction(async (tx) => {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ ct: string } & Record<string, unknown>>(
      sql`SELECT ${encryptSecretSql(plaintext)} AS ct`,
    );
    const ct = rows[0]?.ct;
    if (!ct) throw new ConflictException('slack_encryption_failed');
    return ct;
  });
}

export async function decryptSecretValue(db: Db | Tx, ciphertext: string): Promise<string> {
  return await db.transaction(async (tx) => {
    await tx.execute(setEncryptionKeySql());
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) throw new ConflictException('slack_decryption_failed');
    return pt;
  });
}

function signInstallState(state: InstallState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${signHmac(payload, secret)}`;
}

export function verifyInstallState(raw: unknown, secret: string): InstallState | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!verifyHmac(payload, secret, signature)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const state = parsed as Partial<InstallState>;
  if (typeof state.orgId !== 'string' || typeof state.exp !== 'number') return null;
  if (state.exp < Date.now()) return null;
  return {
    orgId: state.orgId,
    userId: typeof state.userId === 'string' ? state.userId : null,
    exp: state.exp,
  };
}

function toRouteDto(row: typeof schema.slackChannelRoutes.$inferSelect): SlackRouteDto {
  return {
    id: row.id,
    slackChannelId: row.slackChannelId,
    slackChannelName: row.slackChannelName,
    purpose: row.purpose,
    mention: row.mention,
  };
}

function toIntegrationDto(
  row: typeof schema.slackIntegrations.$inferSelect,
  routes: (typeof schema.slackChannelRoutes.$inferSelect)[],
): SlackIntegrationDto {
  return {
    id: row.id,
    teamId: row.teamId,
    teamName: row.teamName,
    botUserId: row.botUserId,
    active: row.active,
    installedByUserId: row.installedByUserId,
    routes: routes.map(toRouteDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SlackService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SlackApiClient) private readonly api: SlackApiClient,
  ) {}

  async status(): Promise<SlackStatusDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const [integration] = await ctx.db
      .select()
      .from(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.orgId, orgId))
      .limit(1);

    let dto: SlackIntegrationDto | null = null;
    let pending = 0;
    let failedLastDay = 0;
    if (integration) {
      const routes = await ctx.db
        .select()
        .from(schema.slackChannelRoutes)
        .where(eq(schema.slackChannelRoutes.integrationId, integration.id));
      dto = toIntegrationDto(integration, routes);

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [pendingRow] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.slackDeliveries)
        .where(
          and(
            eq(schema.slackDeliveries.orgId, orgId),
            isNull(schema.slackDeliveries.deliveredAt),
          ),
        );
      const [failedRow] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.slackDeliveries)
        .where(
          and(
            eq(schema.slackDeliveries.orgId, orgId),
            isNotNull(schema.slackDeliveries.deliveredAt),
            isNotNull(schema.slackDeliveries.error),
            gt(schema.slackDeliveries.createdAt, dayAgo),
          ),
        );
      pending = pendingRow?.n ?? 0;
      failedLastDay = failedRow?.n ?? 0;
    }

    return {
      appConfigured: readSlackAppConfig() !== null,
      connected: integration?.active === true,
      integration: dto,
      deliveries: { pending, failedLastDay },
    };
  }

  installUrl(): { url: string; expiresAt: string } {
    const config = readSlackAppConfig();
    if (!config) {
      throw new BadRequestException(
        'slack_not_configured: this deployment has no Slack app. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET (see skill://slack/connect-slack).',
      );
    }
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const userId = actor.type === 'user' ? actor.id : (actor.userId ?? null);
    const exp = Date.now() + INSTALL_STATE_TTL_MS;
    const state = signInstallState({ orgId: actor.orgId, userId, exp }, config.clientSecret);
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
    url.searchParams.set('redirect_uri', slackOAuthRedirectUri());
    url.searchParams.set('state', state);
    return { url: url.toString(), expiresAt: new Date(exp).toISOString() };
  }

  /**
   * Public OAuth callback path — no tenant context; org + installer come from
   * the signed state minted by installUrl(). Runs on the service-role DB.
   */
  async completeInstall(input: { code: string; state: string }): Promise<{ orgId: string }> {
    const config = readSlackAppConfig();
    if (!config) throw new BadRequestException('slack_not_configured');
    const state = verifyInstallState(input.state, config.clientSecret);
    if (!state) throw new BadRequestException('slack_invalid_state');

    const install = await this.api.oauthAccess({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code: input.code,
      redirectUri: slackOAuthRedirectUri(),
    });
    const encryptedBotToken = await encryptSecretValue(this.db, install.botToken);

    const [existing] = await this.db
      .select({ id: schema.slackIntegrations.id })
      .from(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.orgId, state.orgId))
      .limit(1);

    if (existing) {
      await this.db
        .update(schema.slackIntegrations)
        .set({
          teamId: install.teamId,
          teamName: install.teamName,
          encryptedBotToken,
          botUserId: install.botUserId,
          appId: install.appId,
          installedByUserId: state.userId,
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(schema.slackIntegrations.id, existing.id));
    } else {
      await this.db.insert(schema.slackIntegrations).values({
        orgId: state.orgId,
        teamId: install.teamId,
        teamName: install.teamName,
        encryptedBotToken,
        botUserId: install.botUserId,
        appId: install.appId,
        installedByUserId: state.userId,
      });
    }
    return { orgId: state.orgId };
  }

  async setRouting(input: SetRoutingInput): Promise<SlackRouteDto & { botInChannel: boolean }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const purpose = input.purpose ?? 'default';

    const [integration] = await ctx.db
      .select()
      .from(schema.slackIntegrations)
      .where(and(eq(schema.slackIntegrations.orgId, orgId), eq(schema.slackIntegrations.active, true)))
      .limit(1);
    if (!integration) {
      throw new NotFoundException(
        'slack_not_connected: no active Slack workspace for this org. Use slack_get_install_url first.',
      );
    }

    const token = await decryptSecretValue(ctx.db, integration.encryptedBotToken);
    let channel;
    try {
      channel = await this.api.conversationsInfo({ token, channel: input.slackChannelId });
    } catch (err) {
      if (err instanceof SlackApiError && err.apiError === 'channel_not_found') {
        throw new BadRequestException(
          `slack_channel_not_found: ${input.slackChannelId} does not exist in workspace ${integration.teamId} (pass the channel ID, e.g. C0123456789, not the #name)`,
        );
      }
      throw err;
    }

    const [conflicting] = await this.db
      .select({ orgId: schema.slackChannelRoutes.orgId })
      .from(schema.slackChannelRoutes)
      .where(
        and(
          eq(schema.slackChannelRoutes.teamId, integration.teamId),
          eq(schema.slackChannelRoutes.slackChannelId, input.slackChannelId),
          ne(schema.slackChannelRoutes.integrationId, integration.id),
        ),
      )
      .limit(1);
    if (conflicting) {
      throw new ConflictException(
        'slack_conflict: that Slack channel is already routed to a different Munin org — channels can only mirror one org',
      );
    }

    const [existing] = await ctx.db
      .select({ id: schema.slackChannelRoutes.id })
      .from(schema.slackChannelRoutes)
      .where(
        and(
          eq(schema.slackChannelRoutes.integrationId, integration.id),
          eq(schema.slackChannelRoutes.purpose, purpose),
        ),
      )
      .limit(1);

    const values = {
      teamId: integration.teamId,
      slackChannelId: channel.id,
      slackChannelName: channel.name,
      mention: input.mention ?? null,
      updatedAt: new Date(),
    };
    let row;
    if (existing) {
      [row] = await ctx.db
        .update(schema.slackChannelRoutes)
        .set(values)
        .where(eq(schema.slackChannelRoutes.id, existing.id))
        .returning();
    } else {
      [row] = await ctx.db
        .insert(schema.slackChannelRoutes)
        .values({ orgId, integrationId: integration.id, purpose, ...values })
        .returning();
    }
    if (!row) throw new ConflictException('slack_route_write_failed');
    return { ...toRouteDto(row), botInChannel: channel.isMember };
  }

  async sendTest(): Promise<{ ok: true; slackChannelId: string; ts: string }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const [integration] = await ctx.db
      .select()
      .from(schema.slackIntegrations)
      .where(and(eq(schema.slackIntegrations.orgId, orgId), eq(schema.slackIntegrations.active, true)))
      .limit(1);
    if (!integration) {
      throw new NotFoundException('slack_not_connected: use slack_get_install_url first');
    }
    const [route] = await ctx.db
      .select()
      .from(schema.slackChannelRoutes)
      .where(
        and(
          eq(schema.slackChannelRoutes.integrationId, integration.id),
          eq(schema.slackChannelRoutes.purpose, 'default'),
        ),
      )
      .limit(1);
    if (!route) {
      throw new BadRequestException(
        'slack_no_default_route: pick a channel with slack_set_routing first',
      );
    }
    const [org] = await ctx.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId))
      .limit(1);
    const token = await decryptSecretValue(ctx.db, integration.encryptedBotToken);
    try {
      const posted = await this.api.postMessage({
        token,
        channel: route.slackChannelId,
        text: testMessageText(org?.name ?? null),
      });
      return { ok: true, slackChannelId: posted.channel, ts: posted.ts };
    } catch (err) {
      if (err instanceof SlackApiError && err.apiError === 'not_in_channel') {
        throw new BadRequestException(
          'slack_bot_not_in_channel: invite the bot to the channel in Slack (/invite @Munin), then retry',
        );
      }
      throw err;
    }
  }

  async disconnect(): Promise<{ disconnected: true; id: string }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const result = await ctx.db
      .delete(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.orgId, orgId))
      .returning({ id: schema.slackIntegrations.id });
    if (result.length === 0) {
      throw new NotFoundException('slack_not_connected: nothing to disconnect');
    }
    return { disconnected: true, id: result[0]!.id };
  }
}
