import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@getmunin/db';
import { getCurrentContext } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import {
  CredentialHandoffService,
  type CredentialLink,
} from '../credential-handoff/credential-handoff.service.ts';
import type {
  CredentialApplyResult,
  CredentialTargetDescription,
  CredentialTargetHandler,
} from '../credential-handoff/credential-target.ts';
import { decryptBridgeSecret, encryptBridgeSecret } from '../operator-bridge/bridge-secrets.ts';
import {
  TeamsApiClient,
  TeamsApiError,
  type TeamsBotCredentials,
  type TeamsChannel,
} from './teams-api.client.ts';
import { buildTeamsAppPackage } from './teams-app-package.ts';
import { htmlActivity, testMessageHtml } from './teams-projection.ts';
import { TEAMS_CREDENTIAL_TARGET, teamsMessagingEndpoint } from './teams.constants.ts';

type IntegrationRow = typeof schema.teamsIntegrations.$inferSelect;
type InstalledTeamRow = typeof schema.teamsInstalledTeams.$inferSelect;
type RouteRow = typeof schema.teamsChannelRoutes.$inferSelect;

export type TeamsRoutePurpose = 'default' | 'escalations';

export interface TeamsRouteDto {
  id: string;
  teamsChannelId: string;
  teamsChannelName: string | null;
  teamId: string | null;
  purpose: string;
  convChannelId: string | null;
}

export interface TeamsInstalledTeamDto {
  teamId: string;
  teamName: string | null;
  installed: boolean;
}

export interface TeamsIntegrationDto {
  id: string;
  appId: string;
  botTenantId: string;
  credentialState: 'pending' | 'active';
  installedByUserId: string | null;
  teams: TeamsInstalledTeamDto[];
  routes: TeamsRouteDto[];
  createdAt: string;
  updatedAt: string;
}

export interface TeamsStatusDto {
  connected: boolean;
  messagingEndpoint: string;
  integration: TeamsIntegrationDto | null;
  deliveries: { pending: number; failedLastDay: number };
}

export interface TeamsUserLinkDto {
  id: string;
  aadObjectId: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  createdAt: string;
}

export interface TeamsChannelOption {
  id: string;
  name: string;
  teamId: string;
  teamName: string | null;
}

export interface SetTeamsRoutingInput {
  teamsChannelId: string;
  purpose?: TeamsRoutePurpose;
  convChannelId?: string | null;
}

export async function encryptTeamsSecret(db: Db | Tx, plaintext: string): Promise<string> {
  return await encryptBridgeSecret(db, plaintext, 'teams_encryption_failed');
}

export async function teamsBotCredentials(
  db: Db | Tx,
  integration: IntegrationRow,
): Promise<TeamsBotCredentials | null> {
  if (!integration.encryptedAppSecret) return null;
  const appSecret = await decryptBridgeSecret(
    db,
    integration.encryptedAppSecret,
    'teams_decryption_failed',
  );
  return { appId: integration.appId, tenantId: integration.botTenantId, appSecret };
}

function toRouteDto(row: RouteRow, teams: InstalledTeamRow[]): TeamsRouteDto {
  return {
    id: row.id,
    teamsChannelId: row.teamsChannelId,
    teamsChannelName: row.teamsChannelName,
    teamId: teams.find((t) => t.id === row.installedTeamId)?.teamId ?? null,
    purpose: row.purpose,
    convChannelId: row.convChannelId,
  };
}

function toIntegrationDto(
  row: IntegrationRow,
  teams: InstalledTeamRow[],
  routes: RouteRow[],
): TeamsIntegrationDto {
  return {
    id: row.id,
    appId: row.appId,
    botTenantId: row.botTenantId,
    credentialState: row.encryptedAppSecret ? 'active' : 'pending',
    installedByUserId: row.installedByUserId,
    teams: teams.map((t) => ({ teamId: t.teamId, teamName: t.teamName, installed: t.installed })),
    routes: routes.map((r) => toRouteDto(r, teams)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function describeTeamsError(err: TeamsApiError): string {
  if (err.fromTokenEndpoint && err.code !== 'invalid_client' && err.code !== 'unauthorized_client') {
    const detail = err.tokenDetail ? `: ${err.tokenDetail}` : '';
    return `Microsoft Entra refused the token request (${err.code})${detail} — check the bot app id and tenant id`;
  }
  switch (err.code) {
    case 'invalid_client':
      return 'Microsoft rejected the client secret (invalid_client) — check it was copied from the bot registration and has not expired';
    case 'unauthorized_client':
      return 'Microsoft rejected the app id for this tenant (unauthorized_client) — check the bot app id and Entra tenant id';
    case 'MessageWritesBlocked':
    case 'BotDisabledByAdmin':
      return 'Teams is blocking the bot from posting — it may have been removed from the team or blocked by an admin';
    default:
      return `Teams rejected the request (${err.status} ${err.code})`;
  }
}

@Injectable()
export class TeamsService implements CredentialTargetHandler {
  readonly targetType = TEAMS_CREDENTIAL_TARGET;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TeamsApiClient) private readonly api: TeamsApiClient,
    @Inject(CredentialHandoffService) private readonly handoff: CredentialHandoffService,
  ) {}

  async status(): Promise<TeamsStatusDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const integration = await this.integrationFor(orgId);
    let dto: TeamsIntegrationDto | null = null;
    let pending = 0;
    let failedLastDay = 0;
    if (integration) {
      const { teams, routes } = await this.teamsAndRoutes(integration.id);
      dto = toIntegrationDto(integration, teams, routes);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [pendingRow] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.teamsDeliveries)
        .where(and(eq(schema.teamsDeliveries.orgId, orgId), isNull(schema.teamsDeliveries.deliveredAt)));
      const [failedRow] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.teamsDeliveries)
        .where(
          and(
            eq(schema.teamsDeliveries.orgId, orgId),
            isNotNull(schema.teamsDeliveries.deliveredAt),
            isNotNull(schema.teamsDeliveries.error),
            gt(schema.teamsDeliveries.createdAt, dayAgo),
          ),
        );
      pending = pendingRow?.n ?? 0;
      failedLastDay = failedRow?.n ?? 0;
    }
    return {
      connected: integration?.active === true && integration.encryptedAppSecret !== null,
      messagingEndpoint: teamsMessagingEndpoint(),
      integration: dto,
      deliveries: { pending, failedLastDay },
    };
  }

  async createConnection(input: {
    appId: string;
    tenantId: string;
    appSecret?: string;
  }): Promise<{ integration: TeamsIntegrationDto; messagingEndpoint: string; credentials: CredentialLink | null }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const appId = input.appId.trim().toLowerCase();
    const tenantId = input.tenantId.trim().toLowerCase();
    const appSecret = input.appSecret?.trim() || null;

    const existing = await this.integrationFor(actor.orgId);
    if (existing) {
      throw new ConflictException(
        `teams_conflict: this org already has a Teams bot connected (app ${existing.appId}) — use teams_request_credentials to re-enter its client secret, or teams_disconnect first to switch bots`,
      );
    }
    const [claimed] = await this.db
      .select({ id: schema.teamsIntegrations.id })
      .from(schema.teamsIntegrations)
      .where(eq(schema.teamsIntegrations.appId, appId))
      .limit(1);
    if (claimed) {
      throw new ConflictException(
        'teams_conflict: that bot app id is already connected to a different Munin org — every org registers its own bot',
      );
    }

    if (appSecret) {
      this.api.forgetToken(appId);
      try {
        await this.api.acquireToken({ appId, tenantId, appSecret });
      } catch (err) {
        if (err instanceof TeamsApiError) {
          throw new BadRequestException(`teams_invalid_credentials: ${describeTeamsError(err)}`);
        }
        throw err;
      }
    }

    const userId = actor.type === 'user' ? actor.id : (actor.userId ?? null);
    const encryptedAppSecret = appSecret ? await encryptTeamsSecret(ctx.db, appSecret) : null;
    const [row] = await ctx.db
      .insert(schema.teamsIntegrations)
      .values({ orgId: actor.orgId, appId, botTenantId: tenantId, installedByUserId: userId, encryptedAppSecret })
      .returning();
    if (!row) throw new ConflictException('teams_integration_write_failed');
    const credentials = appSecret
      ? null
      : await this.handoff.mint({ targetType: this.targetType, targetId: row.id });
    return {
      integration: toIntegrationDto(row, [], []),
      messagingEndpoint: teamsMessagingEndpoint(),
      credentials,
    };
  }

  async requestCredentials(): Promise<CredentialLink> {
    const integration = await this.requireIntegration();
    return await this.handoff.mint({ targetType: this.targetType, targetId: integration.id });
  }

  async describe(targetId: string): Promise<CredentialTargetDescription | null> {
    const row = await this.integrationById(getCurrentContext().db, targetId);
    if (!row) return null;
    return {
      label: `Teams bot ${row.appId}`,
      vendor: 'Microsoft Teams',
      fields: [{ key: 'appSecret', label: 'Client secret', required: true }],
    };
  }

  async apply(targetId: string, secrets: Record<string, string>): Promise<CredentialApplyResult> {
    const ctx = getCurrentContext();
    const row = await this.integrationById(ctx.db, targetId);
    if (!row) return { ok: false, error: 'the Teams connection no longer exists' };
    const secret = (secrets.appSecret ?? '').trim();
    if (secret.length === 0 || secret.length > 512) {
      return { ok: false, error: 'enter the bot client secret' };
    }
    const encryptedAppSecret = await encryptTeamsSecret(ctx.db, secret);
    await ctx.db
      .update(schema.teamsIntegrations)
      .set({ encryptedAppSecret, updatedAt: new Date() })
      .where(eq(schema.teamsIntegrations.id, row.id));
    this.api.forgetToken(row.appId);
    return { ok: true, detail: 'credentials saved' };
  }

  async verify(targetId: string): Promise<CredentialApplyResult> {
    const row = await this.integrationById(this.db, targetId);
    if (!row) return { ok: false, error: 'the Teams connection no longer exists' };
    const creds = await teamsBotCredentials(this.db, row);
    if (!creds) return { ok: false, error: 'no client secret stored' };
    try {
      await this.api.acquireToken(creds);
      return { ok: true, detail: 'credentials saved and verified' };
    } catch (err) {
      if (err instanceof TeamsApiError) return { ok: false, error: describeTeamsError(err) };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async appPackage(): Promise<{ filename: string; data: Buffer }> {
    const ctx = getCurrentContext();
    const integration = await this.requireIntegration();
    const [org] = await ctx.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, integration.orgId))
      .limit(1);
    return {
      filename: 'munin-teams-app.zip',
      data: buildTeamsAppPackage({ appId: integration.appId, orgName: org?.name ?? null }),
    };
  }

  async listChannels(): Promise<{ channels: TeamsChannelOption[] }> {
    const integration = await this.requireIntegration();
    const creds = await this.requireCredentials(integration);
    const teams = (await this.teamsAndRoutes(integration.id)).teams.filter((t) => t.installed);
    const channels: TeamsChannelOption[] = [];
    for (const team of teams) {
      for (const channel of await this.teamChannels(creds, team)) {
        channels.push({ id: channel.id, name: channel.name, teamId: team.teamId, teamName: team.teamName });
      }
    }
    channels.sort(
      (a, b) =>
        (a.teamName ?? a.teamId).localeCompare(b.teamName ?? b.teamId) || a.name.localeCompare(b.name),
    );
    return { channels };
  }

  async setRouting(input: SetTeamsRoutingInput): Promise<TeamsRouteDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const purpose = input.purpose ?? 'default';
    const convChannelId = input.convChannelId ?? null;
    if (convChannelId && purpose !== 'default') {
      throw new BadRequestException(
        `teams_invalid_routing: ${purpose} cannot be scoped to a source channel — omit convChannelId`,
      );
    }
    const integration = await this.requireIntegration();
    const creds = await this.requireCredentials(integration);

    if (convChannelId) {
      const [convChannel] = await ctx.db
        .select({ id: schema.convChannels.id })
        .from(schema.convChannels)
        .where(and(eq(schema.convChannels.id, convChannelId), eq(schema.convChannels.orgId, orgId)))
        .limit(1);
      if (!convChannel) {
        throw new BadRequestException(
          `teams_conv_channel_not_found: ${convChannelId} is not a conversation channel in this org (see conv_list_channels)`,
        );
      }
    }

    const { teams, routes } = await this.teamsAndRoutes(integration.id);
    let match: { team: InstalledTeamRow; channel: TeamsChannel } | null = null;
    for (const team of teams.filter((t) => t.installed)) {
      const channel = (await this.teamChannels(creds, team)).find((c) => c.id === input.teamsChannelId);
      if (channel) {
        match = { team, channel };
        break;
      }
    }
    if (!match) {
      throw new BadRequestException(
        'teams_channel_not_found: that channel is not in a team the Munin bot is installed in — add the app to the team first, then pick an id from teams_list_channels',
      );
    }

    const existing = routes.find((r) =>
      convChannelId ? r.convChannelId === convChannelId : r.purpose === purpose && !r.convChannelId,
    );
    const conflicting = routes.find((r) => r.teamsChannelId === match.channel.id);
    if (conflicting && conflicting.id !== existing?.id) {
      throw new ConflictException(
        `teams_conflict: that Teams channel is already used by this org's '${conflicting.purpose}' route — every route needs its own channel (escalations falls back to the default channel when unset)`,
      );
    }

    const values = {
      installedTeamId: match.team.id,
      teamsChannelId: match.channel.id,
      teamsChannelName: match.channel.name,
      convChannelId,
      updatedAt: new Date(),
    };
    let row: RouteRow | undefined;
    if (existing) {
      [row] = await ctx.db
        .update(schema.teamsChannelRoutes)
        .set(values)
        .where(eq(schema.teamsChannelRoutes.id, existing.id))
        .returning();
    } else {
      [row] = await ctx.db
        .insert(schema.teamsChannelRoutes)
        .values({ orgId, integrationId: integration.id, purpose, ...values })
        .returning();
    }
    if (!row) throw new ConflictException('teams_route_write_failed');
    return toRouteDto(row, teams);
  }

  async sendTest(): Promise<{ ok: true; teamsChannelId: string; activityId: string }> {
    const ctx = getCurrentContext();
    const integration = await this.requireIntegration();
    const creds = await this.requireCredentials(integration);
    const { teams, routes } = await this.teamsAndRoutes(integration.id);
    const route = routes.find((r) => r.purpose === 'default' && !r.convChannelId);
    if (!route) {
      throw new BadRequestException(
        'teams_no_default_route: pick a channel with teams_set_routing first',
      );
    }
    const team = teams.find((t) => t.id === route.installedTeamId);
    if (!team || !team.installed) {
      throw new BadRequestException(
        'teams_bot_not_installed: the Munin app is no longer installed in that team — add it again, then retry',
      );
    }
    const [org] = await ctx.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, integration.orgId))
      .limit(1);
    try {
      const posted = await this.api.createChannelThread({
        creds,
        serviceUrl: team.serviceUrl,
        channelId: route.teamsChannelId,
        tenantId: team.tenantId,
        activity: htmlActivity(testMessageHtml(org?.name ?? null)),
      });
      return { ok: true, teamsChannelId: route.teamsChannelId, activityId: posted.activityId };
    } catch (err) {
      if (err instanceof TeamsApiError) {
        throw new BadRequestException(`teams_api_error: ${describeTeamsError(err)}`);
      }
      throw err;
    }
  }

  async listUserLinks(): Promise<TeamsUserLinkDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        id: schema.teamsUserLinks.id,
        aadObjectId: schema.teamsUserLinks.aadObjectId,
        userId: schema.teamsUserLinks.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        createdAt: schema.teamsUserLinks.createdAt,
      })
      .from(schema.teamsUserLinks)
      .innerJoin(schema.users, eq(schema.users.id, schema.teamsUserLinks.userId))
      .where(eq(schema.teamsUserLinks.orgId, ctx.actor!.orgId));
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  async linkUser(input: { aadObjectId: string; userId: string }): Promise<TeamsUserLinkDto> {
    const ctx = getCurrentContext();
    const orgId = ctx.actor!.orgId;
    const integration = await this.requireIntegration();
    const aadObjectId = input.aadObjectId.trim().toLowerCase();
    const [member] = await ctx.db
      .select({ name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.users.id))
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.users.id, input.userId)))
      .limit(1);
    if (!member) {
      throw new BadRequestException(
        `teams_user_not_member: ${input.userId} is not a member of this org — invite them first`,
      );
    }
    const [existing] = await ctx.db
      .select({ id: schema.teamsUserLinks.id })
      .from(schema.teamsUserLinks)
      .where(
        and(
          eq(schema.teamsUserLinks.integrationId, integration.id),
          eq(schema.teamsUserLinks.aadObjectId, aadObjectId),
        ),
      )
      .limit(1);
    let row: typeof schema.teamsUserLinks.$inferSelect | undefined;
    if (existing) {
      [row] = await ctx.db
        .update(schema.teamsUserLinks)
        .set({ userId: input.userId, updatedAt: new Date() })
        .where(eq(schema.teamsUserLinks.id, existing.id))
        .returning();
    } else {
      [row] = await ctx.db
        .insert(schema.teamsUserLinks)
        .values({ orgId, integrationId: integration.id, aadObjectId, userId: input.userId })
        .returning();
    }
    if (!row) throw new ConflictException('teams_user_link_write_failed');
    return {
      id: row.id,
      aadObjectId: row.aadObjectId,
      userId: row.userId,
      userName: member.name,
      userEmail: member.email,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async unlinkUser(input: { aadObjectId: string }): Promise<{ unlinked: true; aadObjectId: string }> {
    const ctx = getCurrentContext();
    const aadObjectId = input.aadObjectId.trim().toLowerCase();
    const result = await ctx.db
      .delete(schema.teamsUserLinks)
      .where(
        and(
          eq(schema.teamsUserLinks.orgId, ctx.actor!.orgId),
          eq(schema.teamsUserLinks.aadObjectId, aadObjectId),
        ),
      )
      .returning({ id: schema.teamsUserLinks.id });
    if (result.length === 0) {
      throw new NotFoundException(`teams_user_link_not_found: ${aadObjectId} is not linked`);
    }
    return { unlinked: true, aadObjectId };
  }

  async disconnect(): Promise<{ disconnected: true; id: string }> {
    const ctx = getCurrentContext();
    const result = await ctx.db
      .delete(schema.teamsIntegrations)
      .where(eq(schema.teamsIntegrations.orgId, ctx.actor!.orgId))
      .returning({ id: schema.teamsIntegrations.id, appId: schema.teamsIntegrations.appId });
    const removed = result[0];
    if (!removed) throw new NotFoundException('teams_not_connected: nothing to disconnect');
    this.api.forgetToken(removed.appId);
    return { disconnected: true, id: removed.id };
  }

  private async integrationFor(orgId: string): Promise<IntegrationRow | null> {
    const [row] = await getCurrentContext()
      .db.select()
      .from(schema.teamsIntegrations)
      .where(eq(schema.teamsIntegrations.orgId, orgId))
      .limit(1);
    return row ?? null;
  }

  private async integrationById(db: Db | Tx, id: string): Promise<IntegrationRow | null> {
    const [row] = await db
      .select()
      .from(schema.teamsIntegrations)
      .where(eq(schema.teamsIntegrations.id, id))
      .limit(1);
    return row ?? null;
  }

  private async requireIntegration(): Promise<IntegrationRow> {
    const integration = await this.integrationFor(getCurrentContext().actor!.orgId);
    if (!integration || !integration.active) {
      throw new NotFoundException(
        'teams_not_connected: no Teams bot is connected to this org. Use teams_create_connection first.',
      );
    }
    return integration;
  }

  private async requireCredentials(integration: IntegrationRow): Promise<TeamsBotCredentials> {
    const creds = await teamsBotCredentials(getCurrentContext().db, integration);
    if (!creds) {
      throw new BadRequestException(
        'teams_credentials_missing: the bot client secret has not been entered yet — open the link from teams_request_credentials',
      );
    }
    return creds;
  }

  private async teamsAndRoutes(
    integrationId: string,
  ): Promise<{ teams: InstalledTeamRow[]; routes: RouteRow[] }> {
    const ctx = getCurrentContext();
    const teams = await ctx.db
      .select()
      .from(schema.teamsInstalledTeams)
      .where(eq(schema.teamsInstalledTeams.integrationId, integrationId));
    const routes = await ctx.db
      .select()
      .from(schema.teamsChannelRoutes)
      .where(eq(schema.teamsChannelRoutes.integrationId, integrationId));
    return { teams, routes };
  }

  private async teamChannels(
    creds: TeamsBotCredentials,
    team: InstalledTeamRow,
  ): Promise<TeamsChannel[]> {
    try {
      return await this.api.listTeamChannels({ creds, serviceUrl: team.serviceUrl, teamId: team.teamId });
    } catch (err) {
      if (err instanceof TeamsApiError) {
        throw new BadRequestException(
          `teams_api_error: could not list channels for team ${team.teamName ?? team.teamId} — ${describeTeamsError(err)}`,
        );
      }
      throw err;
    }
  }
}
