import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNotNull, isNull, like, lt, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import {
  CredentialResolver,
  decryptSecretSql,
  encryptSecretSql,
  getCurrentContext,
  OrgAccessDeniedError,
  randomToken,
} from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { readSignedState, signSignedState } from '../../common/outbound-oauth/signed-state.ts';
import { authorizationServerUrl } from '../../oauth/oauth.constants.ts';
import { SlackApiClient, SlackApiError } from './slack-api.client.ts';
import { testMessageText } from './slack-projection.ts';
import { isChannelShared, sharedChannelIds } from './slack-shared-channel.ts';
import { readSlackAppConfig, SLACK_BOT_SCOPES } from './slack.constants.ts';

const INSTALL_STATE_TTL_MS = 10 * 60 * 1000;
const INSTALL_TICKET_KIND = 'slack_install_ticket';
const INSTALL_STATE_KIND = 'slack_install_state';
const INSTALL_RECORD_PREFIX = 'slack-install:';
const INSTALL_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);
const SIGNIN_REQUIRED_MESSAGE =
  'slack_install_signin_required: sign in to Munin as an owner or admin of this organization, then connect Slack again';
const FORBIDDEN_MESSAGE =
  'slack_install_forbidden: only an owner or admin of the organization this link was made for can connect Slack to it';

export interface SlackRouteDto {
  id: string;
  slackChannelId: string;
  slackChannelName: string | null;
  purpose: string;
  convChannelId: string | null;
  mention: string | null;
  sharedChannel: boolean;
}

export interface SlackRoutingResult extends SlackRouteDto {
  botInChannel: boolean;
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
  appConfigured: boolean;
  connected: boolean;
  integration: SlackIntegrationDto | null;
  deliveries: { pending: number; failedLastDay: number };
}

export interface SetRoutingInput {
  slackChannelId: string;
  purpose?: 'default' | 'escalations' | 'approvals' | 'content';
  mention?: string | null;
  convChannelId?: string | null;
}

export interface SetRoutingOptions {
  verifiedSlackUserId?: string;
}

interface InstallTicket {
  orgId: string;
  exp: number;
}

interface InstallState {
  orgId: string;
  userId: string;
  exp: number;
  nonce: string;
}

export const SLACK_INSTALL_NONCE_COOKIE = 'slack_install_nonce';
export const SLACK_INSTALL_NONCE_MAX_AGE_MS = INSTALL_STATE_TTL_MS;

export interface InstallUrlResult {
  url: string;
  expiresAt: string;
}

export interface BeginInstallResult {
  orgId: string;
  url: string;
  sessionNonce: string;
}

export type SlackInstallRefusal = 'signin_required' | 'forbidden' | 'expired';

export class SlackInstallRefusedError extends Error {
  constructor(
    readonly reason: SlackInstallRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'SlackInstallRefusedError';
  }
}

export function slackOAuthRedirectUri(): string {
  return `${authorizationServerUrl()}/v1/slack/oauth/callback`;
}

export function slackInstallStartUri(): string {
  return `${authorizationServerUrl()}/v1/slack/oauth/start`;
}

export async function encryptSecretValue(db: Db | Tx, plaintext: string): Promise<string> {
  return await db.transaction(async (tx) => {
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
    const rows = await tx.execute<{ pt: string } & Record<string, unknown>>(
      sql`SELECT ${decryptSecretSql(ciphertext)} AS pt`,
    );
    const pt = rows[0]?.pt;
    if (pt === undefined || pt === null) throw new ConflictException('slack_decryption_failed');
    return pt;
  });
}

export function signInstallTicket(ticket: InstallTicket, secret: string): string {
  return signSignedState({ kind: INSTALL_TICKET_KIND, ...ticket }, secret);
}

export function verifyInstallTicket(raw: unknown, secret: string): InstallTicket | null {
  const ticket = readSignedState(raw, secret);
  if (!ticket || ticket['kind'] !== INSTALL_TICKET_KIND) return null;
  const orgId = ticket['orgId'];
  const exp = ticket['exp'];
  if (typeof orgId !== 'string' || typeof exp !== 'number') return null;
  return { orgId, exp };
}

export function signInstallState(state: InstallState, secret: string): string {
  return signSignedState({ kind: INSTALL_STATE_KIND, ...state }, secret);
}

export function verifyInstallState(raw: unknown, secret: string): InstallState | null {
  const state = readSignedState(raw, secret);
  if (!state || state['kind'] !== INSTALL_STATE_KIND) return null;
  const { orgId, userId, exp, nonce } = state;
  if (typeof orgId !== 'string' || typeof userId !== 'string') return null;
  if (typeof exp !== 'number' || typeof nonce !== 'string' || nonce.length === 0) return null;
  return { orgId, userId, exp, nonce };
}

function installRecordIdentifier(nonce: string): string {
  return `${INSTALL_RECORD_PREFIX}${createHash('sha256').update(nonce).digest('base64url')}`;
}

function sameNonce(expected: string, presented: string | null | undefined): boolean {
  if (!presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

function toRouteDto(
  row: typeof schema.slackChannelRoutes.$inferSelect,
  sharedChannel: boolean,
): SlackRouteDto {
  return {
    id: row.id,
    slackChannelId: row.slackChannelId,
    slackChannelName: row.slackChannelName,
    purpose: row.purpose,
    convChannelId: row.convChannelId,
    mention: row.mention,
    sharedChannel,
  };
}

function toIntegrationDto(
  row: typeof schema.slackIntegrations.$inferSelect,
  routes: (typeof schema.slackChannelRoutes.$inferSelect)[],
  shared: Set<string>,
): SlackIntegrationDto {
  return {
    id: row.id,
    teamId: row.teamId,
    teamName: row.teamName,
    botUserId: row.botUserId,
    active: row.active,
    installedByUserId: row.installedByUserId,
    routes: routes.map((route) => toRouteDto(route, shared.has(route.slackChannelId))),
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
      const shared = integration.active
        ? await sharedChannelIds(
            this.db,
            integration,
            routes.map((route) => route.slackChannelId),
          )
        : new Set<string>();
      dto = toIntegrationDto(integration, routes, shared);

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

  installUrl(): InstallUrlResult {
    const config = this.requireAppConfig();
    const orgId = getCurrentContext().actor!.orgId;
    const exp = Date.now() + INSTALL_STATE_TTL_MS;
    const url = new URL(slackInstallStartUri());
    url.searchParams.set('ticket', signInstallTicket({ orgId, exp }, config.clientSecret));
    return { url: url.toString(), expiresAt: new Date(exp).toISOString() };
  }

  async beginInstall(input: {
    ticket: unknown;
    sessionToken: string | null;
  }): Promise<BeginInstallResult> {
    const config = this.requireAppConfig();
    const ticket = verifyInstallTicket(input.ticket, config.clientSecret);
    if (!ticket) {
      throw new SlackInstallRefusedError(
        'expired',
        'slack_install_link_expired: this install link is invalid or has expired — get a fresh one',
      );
    }
    const userId = await this.sessionInstaller(input.sessionToken, ticket.orgId);

    const sessionNonce = randomToken(24);
    const exp = Date.now() + INSTALL_STATE_TTL_MS;
    await this.db
      .delete(schema.verifications)
      .where(
        and(
          like(schema.verifications.identifier, `${INSTALL_RECORD_PREFIX}%`),
          lt(schema.verifications.expiresAt, new Date()),
        ),
      );
    await this.db.insert(schema.verifications).values({
      identifier: installRecordIdentifier(sessionNonce),
      value: JSON.stringify({ orgId: ticket.orgId, userId }),
      expiresAt: new Date(exp),
    });

    const state = signInstallState(
      { orgId: ticket.orgId, userId, exp, nonce: sessionNonce },
      config.clientSecret,
    );
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
    url.searchParams.set('redirect_uri', slackOAuthRedirectUri());
    url.searchParams.set('state', state);
    return { orgId: ticket.orgId, url: url.toString(), sessionNonce };
  }

  async completeInstall(input: {
    code: string;
    state: string;
    sessionNonce: string | null;
    sessionToken: string | null;
  }): Promise<{ orgId: string }> {
    const config = this.requireAppConfig();
    const state = verifyInstallState(input.state, config.clientSecret);
    if (!state || !sameNonce(state.nonce, input.sessionNonce)) {
      throw new BadRequestException('slack_invalid_state');
    }
    if (!(await this.consumeInstallRecord(state))) {
      throw new BadRequestException('slack_invalid_state: this install link was already used');
    }
    const userId = await this.sessionInstaller(input.sessionToken, state.orgId);
    if (userId !== state.userId) {
      throw new SlackInstallRefusedError(
        'forbidden',
        'slack_install_forbidden: finish the install signed in as the person who started it',
      );
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

  private requireAppConfig(): NonNullable<ReturnType<typeof readSlackAppConfig>> {
    const config = readSlackAppConfig();
    if (!config) {
      throw new BadRequestException(
        'slack_not_configured: this deployment has no Slack app. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET (see skill://slack/connect-slack).',
      );
    }
    return config;
  }

  private async sessionInstaller(sessionToken: string | null, orgId: string): Promise<string> {
    if (!sessionToken) {
      throw new SlackInstallRefusedError('signin_required', SIGNIN_REQUIRED_MESSAGE);
    }
    const resolver = new CredentialResolver(this.db);
    if (!(await resolver.resolveSessionUserId(sessionToken))) {
      throw new SlackInstallRefusedError('signin_required', SIGNIN_REQUIRED_MESSAGE);
    }
    let credential;
    try {
      credential = await resolver.resolveSessionToken(sessionToken, orgId);
    } catch (err) {
      if (err instanceof OrgAccessDeniedError) {
        throw new SlackInstallRefusedError('forbidden', FORBIDDEN_MESSAGE);
      }
      throw err;
    }
    const role = credential?.actor.orgRole ?? null;
    if (!credential || !role || !INSTALL_ROLES.has(role)) {
      throw new SlackInstallRefusedError('forbidden', FORBIDDEN_MESSAGE);
    }
    return credential.actor.userId ?? credential.actor.id;
  }

  private async consumeInstallRecord(state: InstallState): Promise<boolean> {
    const rows = await this.db
      .delete(schema.verifications)
      .where(
        and(
          eq(schema.verifications.identifier, installRecordIdentifier(state.nonce)),
          gt(schema.verifications.expiresAt, new Date()),
        ),
      )
      .returning({ value: schema.verifications.value });
    const value = rows[0]?.value;
    if (!value) return false;
    try {
      const record = JSON.parse(value) as { orgId?: unknown; userId?: unknown };
      return record.orgId === state.orgId && record.userId === state.userId;
    } catch {
      return false;
    }
  }

  async setRouting(
    input: SetRoutingInput,
    options: SetRoutingOptions = {},
  ): Promise<SlackRoutingResult> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const purpose = input.purpose ?? 'default';
    const convChannelId = input.convChannelId ?? null;
    if (convChannelId && purpose !== 'default') {
      throw new BadRequestException(
        `slack_invalid_routing: ${purpose} cannot be scoped to a source channel — omit convChannelId`,
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
      if (err instanceof SlackApiError) {
        throw new BadRequestException(
          `slack_api_error: Slack rejected the channel lookup (${err.apiError})`,
        );
      }
      throw err;
    }

    const [existing] = await ctx.db
      .select({
        id: schema.slackChannelRoutes.id,
        slackChannelId: schema.slackChannelRoutes.slackChannelId,
      })
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

    const [conflicting] = await ctx.db
      .select({
        id: schema.slackChannelRoutes.id,
        purpose: schema.slackChannelRoutes.purpose,
      })
      .from(schema.slackChannelRoutes)
      .where(
        and(
          eq(schema.slackChannelRoutes.integrationId, integration.id),
          eq(schema.slackChannelRoutes.slackChannelId, channel.id),
        ),
      )
      .limit(1);
    if (conflicting && conflicting.id !== existing?.id) {
      throw new ConflictException(
        `slack_conflict: that Slack channel is already used by this org's '${conflicting.purpose}' route — every route needs its own channel (escalations falls back to the default channel when unset)`,
      );
    }

    const sharedChannel = await isChannelShared(this.db, integration, channel.id);
    if (sharedChannel && existing?.slackChannelId !== channel.id) {
      await this.assertRouterInChannel(token, channel.id, options.verifiedSlackUserId);
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
    return { ...toRouteDto(row, sharedChannel), botInChannel: channel.isMember };
  }

  private async assertRouterInChannel(
    token: string,
    slackChannelId: string,
    verifiedSlackUserId: string | undefined,
  ): Promise<void> {
    try {
      const slackUserId = verifiedSlackUserId ?? (await this.actorSlackUserId(token));
      if (
        slackUserId &&
        (await this.api.isConversationMember({ token, channel: slackChannelId, user: slackUserId }))
      ) {
        return;
      }
    } catch (err) {
      if (err instanceof SlackApiError) {
        throw new BadRequestException(
          `slack_api_error: Slack rejected the channel membership lookup (${err.apiError})`,
        );
      }
      throw err;
    }
    throw new ForbiddenException({
      message:
        'slack_not_channel_member: another Munin org already routes into that Slack channel, so only someone in the channel can add a route to it — join it in Slack with the account that uses your Munin email address, then try again',
      code: 'slack_not_channel_member',
    });
  }

  private async actorSlackUserId(token: string): Promise<string | null> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const userId = actor.type === 'user' ? actor.id : (actor.userId ?? null);
    if (!userId) return null;
    const [user] = await ctx.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user?.email) return null;
    return await this.api.usersLookupByEmail({ token, email: user.email });
  }

  async listChannels(): Promise<{
    channels: Array<{ id: string; name: string | null; isMember: boolean }>;
  }> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
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
    const channels: Array<{ id: string; name: string | null; isMember: boolean }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      let res;
      try {
        res = await this.api.conversationsList({ token, cursor });
      } catch (err) {
        if (err instanceof SlackApiError) {
          throw new BadRequestException(
            `slack_api_error: could not list channels (${err.apiError})`,
          );
        }
        throw err;
      }
      channels.push(...res.channels);
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    channels.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    return { channels };
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
