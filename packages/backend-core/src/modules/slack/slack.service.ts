import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import {
  decryptSecretSql,
  encryptSecretSql,
  getCurrentContext,
  randomToken,
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
  convChannelId: string | null;
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

export interface SlackUserLinkDto {
  id: string;
  slackUserId: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  createdAt: string;
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
  /** Source-channel override: conversations on this conv channel mirror here. */
  convChannelId?: string | null;
}

interface InstallState {
  orgId: string;
  userId: string | null;
  exp: number;
  /**
   * Present when the install was started from a browser session (the
   * dashboard). The callback requires a matching `slack_install_nonce`
   * cookie, so leaking the URL is not enough to complete the install.
   * Absent for MCP-minted URLs, which a human opens in a fresh browser with
   * no cookie continuity — those rely on the short TTL and the
   * team-mismatch guard in completeInstall.
   */
  nonce?: string;
}

/** Cookie set by the dashboard install endpoint; consumed by the callback. */
export const SLACK_INSTALL_NONCE_COOKIE = 'slack_install_nonce';

export interface InstallUrlResult {
  url: string;
  expiresAt: string;
  /** Set only when bindToSession — the caller stores it in the nonce cookie. */
  sessionNonce?: string;
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
    nonce: typeof state.nonce === 'string' ? state.nonce : undefined,
  };
}

function toRouteDto(row: typeof schema.slackChannelRoutes.$inferSelect): SlackRouteDto {
  return {
    id: row.id,
    slackChannelId: row.slackChannelId,
    slackChannelName: row.slackChannelName,
    purpose: row.purpose,
    convChannelId: row.convChannelId,
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

  installUrl(options: { bindToSession?: boolean } = {}): InstallUrlResult {
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
    const sessionNonce = options.bindToSession ? randomToken(24) : undefined;
    const state = signInstallState(
      { orgId: actor.orgId, userId, exp, nonce: sessionNonce },
      config.clientSecret,
    );
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
    url.searchParams.set('redirect_uri', slackOAuthRedirectUri());
    url.searchParams.set('state', state);
    return { url: url.toString(), expiresAt: new Date(exp).toISOString(), sessionNonce };
  }

  /**
   * Public OAuth callback path — no tenant context; org + installer come from
   * the signed state minted by installUrl(). Runs on the service-role DB.
   */
  async completeInstall(input: {
    code: string;
    state: string;
    sessionNonce?: string | null;
  }): Promise<{ orgId: string }> {
    const config = readSlackAppConfig();
    if (!config) throw new BadRequestException('slack_not_configured');
    const state = verifyInstallState(input.state, config.clientSecret);
    if (!state) throw new BadRequestException('slack_invalid_state');

    // Session binding: a state minted from the dashboard carries a nonce and
    // is only completable by the same browser (matching httpOnly cookie), so
    // a leaked/intercepted install URL cannot be redeemed by anyone else.
    if (state.nonce && state.nonce !== input.sessionNonce) {
      throw new BadRequestException('slack_invalid_state');
    }

    const install = await this.api.oauthAccess({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code: input.code,
      redirectUri: slackOAuthRedirectUri(),
    });
    const encryptedBotToken = await encryptSecretValue(this.db, install.botToken);

    const [existing] = await this.db
      .select({ id: schema.slackIntegrations.id, teamId: schema.slackIntegrations.teamId })
      .from(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.orgId, state.orgId))
      .limit(1);

    // Never silently repoint an existing workspace to a different one — that
    // would redirect all mirrored customer conversations elsewhere. Switching
    // workspaces requires an explicit slack_disconnect first.
    if (existing && existing.teamId !== install.teamId) {
      throw new ConflictException(
        'slack_workspace_mismatch: this org is already connected to a different Slack workspace — disconnect it first, then reinstall',
      );
    }

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
    const convChannelId = input.convChannelId ?? null;
    if (convChannelId && purpose === 'escalations') {
      throw new BadRequestException(
        'slack_invalid_routing: escalations cannot be scoped to a source channel — omit convChannelId',
      );
    }

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

    if (convChannelId) {
      const [convChannel] = await ctx.db
        .select({ id: schema.convChannels.id })
        .from(schema.convChannels)
        .where(and(eq(schema.convChannels.id, convChannelId), eq(schema.convChannels.orgId, orgId)))
        .limit(1);
      if (!convChannel) {
        throw new BadRequestException(
          `slack_conv_channel_not_found: ${convChannelId} is not a conversation channel in this org (see conv_list_channels)`,
        );
      }
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

    const [existing] = await ctx.db
      .select({ id: schema.slackChannelRoutes.id })
      .from(schema.slackChannelRoutes)
      .where(
        and(
          eq(schema.slackChannelRoutes.integrationId, integration.id),
          convChannelId
            ? eq(schema.slackChannelRoutes.convChannelId, convChannelId)
            : and(
                eq(schema.slackChannelRoutes.purpose, purpose),
                isNull(schema.slackChannelRoutes.convChannelId),
              ),
        ),
      )
      .limit(1);

    // One route row per Slack channel, globally: the (team, channel) unique
    // index is both the multi-org invariant and what keeps thread→org
    // resolution unambiguous. Pre-checked because a violation inside the
    // request transaction would surface as a bare 500 at commit time.
    const [conflicting] = await this.db
      .select({
        id: schema.slackChannelRoutes.id,
        orgId: schema.slackChannelRoutes.orgId,
        purpose: schema.slackChannelRoutes.purpose,
      })
      .from(schema.slackChannelRoutes)
      .where(
        and(
          eq(schema.slackChannelRoutes.teamId, integration.teamId),
          eq(schema.slackChannelRoutes.slackChannelId, channel.id),
        ),
      )
      .limit(1);
    if (conflicting && conflicting.id !== existing?.id) {
      if (conflicting.orgId !== orgId) {
        throw new ConflictException(
          'slack_conflict: that Slack channel is already routed to a different Munin org — channels can only mirror one org',
        );
      }
      throw new ConflictException(
        `slack_conflict: that Slack channel is already used by this org's '${conflicting.purpose}' route — every route needs its own channel (escalations falls back to the default channel when unset)`,
      );
    }

    const values = {
      teamId: integration.teamId,
      slackChannelId: channel.id,
      slackChannelName: channel.name,
      convChannelId,
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

  async listUserLinks(): Promise<SlackUserLinkDto[]> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const rows = await ctx.db
      .select({
        id: schema.slackUserLinks.id,
        slackUserId: schema.slackUserLinks.slackUserId,
        userId: schema.slackUserLinks.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        createdAt: schema.slackUserLinks.createdAt,
      })
      .from(schema.slackUserLinks)
      .innerJoin(schema.users, eq(schema.users.id, schema.slackUserLinks.userId))
      .where(eq(schema.slackUserLinks.orgId, orgId));
    return rows.map((row) => ({
      id: row.id,
      slackUserId: row.slackUserId,
      userId: row.userId,
      userName: row.userName,
      userEmail: row.userEmail,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async linkUser(input: { slackUserId: string; userId: string }): Promise<SlackUserLinkDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const [integration] = await ctx.db
      .select({ id: schema.slackIntegrations.id })
      .from(schema.slackIntegrations)
      .where(and(eq(schema.slackIntegrations.orgId, orgId), eq(schema.slackIntegrations.active, true)))
      .limit(1);
    if (!integration) {
      throw new NotFoundException('slack_not_connected: use slack_get_install_url first');
    }

    const [member] = await ctx.db
      .select({ name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.users.id))
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.users.id, input.userId)))
      .limit(1);
    if (!member) {
      throw new BadRequestException(
        `slack_user_not_member: ${input.userId} is not a member of this org — invite them first`,
      );
    }

    const [existing] = await ctx.db
      .select({ id: schema.slackUserLinks.id })
      .from(schema.slackUserLinks)
      .where(
        and(
          eq(schema.slackUserLinks.integrationId, integration.id),
          eq(schema.slackUserLinks.slackUserId, input.slackUserId),
        ),
      )
      .limit(1);
    let row;
    if (existing) {
      [row] = await ctx.db
        .update(schema.slackUserLinks)
        .set({ userId: input.userId, updatedAt: new Date() })
        .where(eq(schema.slackUserLinks.id, existing.id))
        .returning();
    } else {
      [row] = await ctx.db
        .insert(schema.slackUserLinks)
        .values({
          orgId,
          integrationId: integration.id,
          slackUserId: input.slackUserId,
          userId: input.userId,
        })
        .returning();
    }
    if (!row) throw new ConflictException('slack_user_link_write_failed');
    return {
      id: row.id,
      slackUserId: row.slackUserId,
      userId: row.userId,
      userName: member.name,
      userEmail: member.email,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async unlinkUser(input: { slackUserId: string }): Promise<{ unlinked: true; slackUserId: string }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const result = await ctx.db
      .delete(schema.slackUserLinks)
      .where(
        and(
          eq(schema.slackUserLinks.orgId, orgId),
          eq(schema.slackUserLinks.slackUserId, input.slackUserId),
        ),
      )
      .returning({ id: schema.slackUserLinks.id });
    if (result.length === 0) {
      throw new NotFoundException(`slack_user_link_not_found: ${input.slackUserId} is not linked`);
    }
    return { unlinked: true, slackUserId: input.slackUserId };
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
