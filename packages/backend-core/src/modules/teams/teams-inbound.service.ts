import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { ActorIdentity, describeError, withContext, type RequestContext } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { ConvService } from '../conv/conv.service.ts';
import { TeamsApiClient, type TeamsBotCredentials } from './teams-api.client.ts';
import { activityTenantId, type TeamsInboundActivity } from './teams-activity.ts';
import { teamsHtmlToMarkdown } from './teams-html-inbound.ts';
import {
  ATTACHMENTS_NOT_SENT_HTML,
  REPLY_NOT_LINKED_HTML,
  attachmentsDroppedHtml,
  mentionActivity,
} from './teams-projection.ts';
import { TeamsUserMappingService } from './teams-user-mapping.service.ts';
import { teamsBotCredentials } from './teams.service.ts';
import {
  isAllowedServiceUrl,
  normalizeServiceUrl,
  parseThreadConversationId,
  threadConversationId,
} from './teams.constants.ts';

const INTERNAL_NOTE_PREFIX = '!';
const TEXT_ATTACHMENT_TYPES = new Set(['text/html', 'text/plain']);

type IntegrationRow = typeof schema.teamsIntegrations.$inferSelect;
type LinkRow = typeof schema.teamsConversationLinks.$inferSelect;

export interface ConvMessageSender {
  sendMessage(input: {
    conversationId: string;
    body: string;
    internal: boolean;
    authorType: 'user';
    authorId: string;
    claim: boolean;
  }): Promise<{ id: string }>;
}

@Injectable()
export class TeamsInboundService {
  private readonly logger = new Logger(TeamsInboundService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TeamsApiClient) private readonly api: TeamsApiClient,
    @Inject(ConvService) private readonly conv: ConvMessageSender,
    @Inject(TeamsUserMappingService) private readonly mapping: TeamsUserMappingService,
  ) {}

  async integrationForApp(appId: string): Promise<IntegrationRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.teamsIntegrations)
      .where(
        and(
          eq(schema.teamsIntegrations.appId, appId.toLowerCase()),
          eq(schema.teamsIntegrations.active, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  tenantMatches(integration: IntegrationRow, activity: TeamsInboundActivity): boolean {
    const tenantId = activityTenantId(activity);
    return tenantId === null || tenantId.toLowerCase() === integration.botTenantId;
  }

  async processActivity(integration: IntegrationRow, activity: TeamsInboundActivity): Promise<void> {
    if (!this.tenantMatches(integration, activity)) return;
    if (!isAllowedServiceUrl(activity.serviceUrl)) return;
    await this.refreshServiceUrl(integration, activity);
    switch (activity.type) {
      case 'conversationUpdate':
        return await this.handleConversationUpdate(integration, activity);
      case 'installationUpdate':
        return await this.handleInstallationUpdate(integration, activity);
      case 'messageDelete':
        return await this.forgetDeletedMessage(integration, activity);
      case 'message':
        return await this.handleMessage(integration, activity);
      default:
        return;
    }
  }

  private async refreshServiceUrl(
    integration: IntegrationRow,
    activity: TeamsInboundActivity,
  ): Promise<void> {
    const teamId = activity.channelData?.team?.id;
    if (!teamId) return;
    const serviceUrl = normalizeServiceUrl(activity.serviceUrl);
    await this.db
      .update(schema.teamsInstalledTeams)
      .set({ serviceUrl, updatedAt: new Date() })
      .where(
        and(
          eq(schema.teamsInstalledTeams.integrationId, integration.id),
          eq(schema.teamsInstalledTeams.teamId, teamId),
          sql`${schema.teamsInstalledTeams.serviceUrl} <> ${serviceUrl}`,
        ),
      );
  }

  private async handleConversationUpdate(
    integration: IntegrationRow,
    activity: TeamsInboundActivity,
  ): Promise<void> {
    const team = activity.channelData?.team;
    if (!team) return;
    const botId = activity.recipient?.id;
    const eventType = activity.channelData?.eventType;
    const botAdded = !!botId && (activity.membersAdded ?? []).some((m) => m.id === botId);
    const botRemoved = !!botId && (activity.membersRemoved ?? []).some((m) => m.id === botId);
    if (botAdded) {
      await this.upsertTeam(integration, activity, true);
      return;
    }
    if (botRemoved || eventType === 'teamDeleted') {
      await this.upsertTeam(integration, activity, false);
      return;
    }
    if (eventType === 'teamRenamed' && team.name) {
      await this.db
        .update(schema.teamsInstalledTeams)
        .set({ teamName: team.name, updatedAt: new Date() })
        .where(
          and(
            eq(schema.teamsInstalledTeams.integrationId, integration.id),
            eq(schema.teamsInstalledTeams.teamId, team.id),
          ),
        );
      return;
    }
    const channel = activity.channelData?.channel;
    if (eventType === 'channelRenamed' && channel?.name) {
      await this.db
        .update(schema.teamsChannelRoutes)
        .set({ teamsChannelName: channel.name, updatedAt: new Date() })
        .where(
          and(
            eq(schema.teamsChannelRoutes.integrationId, integration.id),
            eq(schema.teamsChannelRoutes.teamsChannelId, channel.id),
          ),
        );
      return;
    }
    if (eventType === 'channelDeleted' && channel) {
      await this.db
        .delete(schema.teamsChannelRoutes)
        .where(
          and(
            eq(schema.teamsChannelRoutes.integrationId, integration.id),
            eq(schema.teamsChannelRoutes.teamsChannelId, channel.id),
          ),
        );
    }
  }

  private async handleInstallationUpdate(
    integration: IntegrationRow,
    activity: TeamsInboundActivity,
  ): Promise<void> {
    if (!activity.channelData?.team) return;
    if (activity.action === 'add' || activity.action === 'add-upgrade') {
      await this.upsertTeam(integration, activity, true);
    } else if (activity.action === 'remove' || activity.action === 'remove-upgrade') {
      await this.upsertTeam(integration, activity, false);
    }
  }

  private async upsertTeam(
    integration: IntegrationRow,
    activity: TeamsInboundActivity,
    installed: boolean,
  ): Promise<void> {
    const team = activity.channelData!.team!;
    const tenantId = (activityTenantId(activity) ?? integration.botTenantId).toLowerCase();
    const serviceUrl = normalizeServiceUrl(activity.serviceUrl);
    await this.db
      .insert(schema.teamsInstalledTeams)
      .values({
        orgId: integration.orgId,
        integrationId: integration.id,
        teamId: team.id,
        teamName: team.name ?? null,
        tenantId,
        serviceUrl,
        installed,
      })
      .onConflictDoUpdate({
        target: [schema.teamsInstalledTeams.integrationId, schema.teamsInstalledTeams.teamId],
        set: {
          installed,
          serviceUrl,
          tenantId,
          ...(team.name ? { teamName: team.name } : {}),
          updatedAt: new Date(),
        },
      });
  }

  private async forgetDeletedMessage(
    integration: IntegrationRow,
    activity: TeamsInboundActivity,
  ): Promise<void> {
    if (!activity.id) return;
    const { channelId } = parseThreadConversationId(activity.conversation.id);
    await this.db
      .delete(schema.teamsConversationLinks)
      .where(
        and(
          eq(schema.teamsConversationLinks.integrationId, integration.id),
          eq(schema.teamsConversationLinks.teamsChannelId, channelId),
          eq(schema.teamsConversationLinks.rootActivityId, activity.id),
        ),
      );
    await this.db
      .delete(schema.teamsMessageLinks)
      .where(
        and(
          eq(schema.teamsMessageLinks.orgId, integration.orgId),
          eq(schema.teamsMessageLinks.teamsChannelId, channelId),
          eq(schema.teamsMessageLinks.activityId, activity.id),
        ),
      );
  }

  private async handleMessage(
    integration: IntegrationRow,
    activity: TeamsInboundActivity,
  ): Promise<void> {
    const { channelId, rootActivityId } = parseThreadConversationId(activity.conversation.id);
    if (!rootActivityId || !activity.id) return;
    const sender = activity.from;
    if (!sender?.aadObjectId || sender.id === activity.recipient?.id) return;

    const [link] = await this.db
      .select()
      .from(schema.teamsConversationLinks)
      .where(
        and(
          eq(schema.teamsConversationLinks.integrationId, integration.id),
          eq(schema.teamsConversationLinks.teamsChannelId, channelId),
          eq(schema.teamsConversationLinks.rootActivityId, rootActivityId),
        ),
      )
      .limit(1);
    if (!link) return;

    const [alreadyLinked] = await this.db
      .select({ id: schema.teamsMessageLinks.id })
      .from(schema.teamsMessageLinks)
      .where(
        and(
          eq(schema.teamsMessageLinks.teamsChannelId, channelId),
          eq(schema.teamsMessageLinks.activityId, activity.id),
        ),
      )
      .limit(1);
    if (alreadyLinked) return;

    const creds = await teamsBotCredentials(this.db, integration);
    if (!creds) return;
    const notify = (html: string) => this.notify({ creds, link, activity, html });

    const userId = await this.mapping.resolveMuninUser({
      integration,
      creds,
      serviceUrl: activity.serviceUrl,
      conversationId: activity.conversation.id,
      sender,
    });
    if (!userId) {
      await notify(REPLY_NOT_LINKED_HTML);
      return;
    }

    const botName = activity.recipient?.name;
    const text = teamsHtmlToMarkdown(activity.text ?? '', { dropMentions: botName ? [botName] : [] });
    const fileCount = (activity.attachments ?? []).filter(
      (a) => !TEXT_ATTACHMENT_TYPES.has(a.contentType),
    ).length;
    if (text.length === 0) {
      if (fileCount > 0) await notify(ATTACHMENTS_NOT_SENT_HTML);
      return;
    }

    const internal = text.startsWith(INTERNAL_NOTE_PREFIX);
    const body = internal ? text.slice(INTERNAL_NOTE_PREFIX.length).trim() : text;
    if (body.length === 0) return;

    const actor = new ActorIdentity(
      'user',
      userId,
      integration.orgId,
      ['*'],
      ['admin'],
      undefined,
      undefined,
      undefined,
      userId,
    );
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await withContext(ctx, async () => {
        const message = await this.conv.sendMessage({
          conversationId: link.conversationId,
          body,
          internal,
          authorType: 'user',
          authorId: userId,
          claim: false,
        });
        await tx.insert(schema.teamsMessageLinks).values({
          orgId: integration.orgId,
          conversationId: link.conversationId,
          messageId: message.id,
          teamsChannelId: channelId,
          activityId: activity.id!,
          origin: 'teams',
        });
      });
    });

    if (fileCount > 0) await notify(attachmentsDroppedHtml(fileCount));
  }

  private async notify(input: {
    creds: TeamsBotCredentials;
    link: LinkRow;
    activity: TeamsInboundActivity;
    html: string;
  }): Promise<void> {
    const sender = input.activity.from!;
    try {
      await this.api.sendToConversation({
        creds: input.creds,
        serviceUrl: input.link.serviceUrl,
        conversationId: threadConversationId(input.link.teamsChannelId, input.link.rootActivityId),
        activity: mentionActivity({
          memberId: sender.id,
          memberName: sender.name ?? 'there',
          html: input.html,
        }),
      });
    } catch (err) {
      this.logger.warn(`teams notice failed: ${describeError(err)}`);
    }
  }
}
