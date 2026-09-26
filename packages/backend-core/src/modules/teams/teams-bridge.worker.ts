import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, lt, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { describeError, parseEnvDisableFlag, parseEnvInt } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { withSchedulerLock } from '../../common/scheduler-lock/index.ts';
import {
  BridgeConversationReader,
  type BridgeConversationContext,
} from '../operator-bridge/bridge-conversation-reader.ts';
import {
  TeamsApiClient,
  TeamsApiError,
  TeamsThrottledError,
  type TeamsActivity,
  type TeamsBotCredentials,
} from './teams-api.client.ts';
import {
  assignedHtml,
  escalationAlertHtml,
  handoverRequestedHtml,
  handoverResolvedHtml,
  htmlActivity,
  messageHtml,
  releasedHtml,
  statusChangedHtml,
  takenOverHtml,
  threadParentActivity,
} from './teams-projection.ts';
import { teamsBotCredentials } from './teams.service.ts';
import { threadConversationId } from './teams.constants.ts';

const POLL_INTERVAL_MS = parseEnvInt({ name: 'MUNIN_TEAMS_POLL_MS', default: 5000 });
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
const MAX_DRAIN_ITERATIONS = 20;
const BACKOFF_BASE_MS = 30_000;
const DEFAULT_THROTTLE_MS = 30_000;

type DeliveryRow = typeof schema.teamsDeliveries.$inferSelect;
type IntegrationRow = typeof schema.teamsIntegrations.$inferSelect;
type RouteRow = typeof schema.teamsChannelRoutes.$inferSelect;
type InstalledTeamRow = typeof schema.teamsInstalledTeams.$inferSelect;
type LinkRow = typeof schema.teamsConversationLinks.$inferSelect;

class TerminalDeliveryError extends Error {}

interface Target {
  route: RouteRow;
  team: InstalledTeamRow;
}

interface DeliveryInput {
  row: DeliveryRow;
  integration: IntegrationRow;
  payload: Record<string, unknown>;
  creds: TeamsBotCredentials;
  routes: RouteRow[];
  teams: InstalledTeamRow[];
}

@Injectable()
export class TeamsBridgeWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disabled =
    parseEnvDisableFlag('MUNIN_TEAMS_WORKER_DISABLED') || process.env.NODE_ENV === 'test';
  private readonly reader: BridgeConversationReader;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TeamsApiClient) private readonly api: TeamsApiClient,
  ) {
    this.reader = new BridgeConversationReader(db);
  }

  onModuleInit(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void withSchedulerLock(this.db, 'teams-bridge-worker', () => this.tick());
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ attempted: number; delivered: number; failed: number }> {
    if (this.running) return { attempted: 0, delivered: 0, failed: 0 };
    this.running = true;
    try {
      return await this.drain();
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<{ attempted: number; delivered: number; failed: number }> {
    let attempted = 0;
    let delivered = 0;
    let failed = 0;
    for (let i = 0; i < MAX_DRAIN_ITERATIONS; i += 1) {
      const rows = await this.db
        .select()
        .from(schema.teamsDeliveries)
        .where(
          and(
            isNull(schema.teamsDeliveries.deliveredAt),
            lt(schema.teamsDeliveries.attempt, MAX_ATTEMPTS),
            lte(schema.teamsDeliveries.nextAttemptAt, new Date()),
            sql`NOT EXISTS (
              SELECT 1 FROM teams_deliveries earlier
              WHERE earlier.conversation_id = teams_deliveries.conversation_id
                AND earlier.delivered_at IS NULL
                AND earlier.attempt < ${MAX_ATTEMPTS}
                AND (earlier.order_at, earlier.order_seq, earlier.created_at, earlier.id)
                    < (teams_deliveries.order_at, teams_deliveries.order_seq,
                       teams_deliveries.created_at, teams_deliveries.id)
            )`,
          ),
        )
        .orderBy(
          schema.teamsDeliveries.orderAt,
          schema.teamsDeliveries.orderSeq,
          schema.teamsDeliveries.createdAt,
          schema.teamsDeliveries.id,
        )
        .limit(BATCH_SIZE);
      if (rows.length === 0) break;
      attempted += rows.length;
      for (const row of rows) {
        const outcome = await this.attemptOne(row);
        if (outcome === 'delivered') delivered += 1;
        else failed += 1;
      }
    }
    return { attempted, delivered, failed };
  }

  private async attemptOne(row: DeliveryRow): Promise<'delivered' | 'failed'> {
    try {
      const [integration] = await this.db
        .select()
        .from(schema.teamsIntegrations)
        .where(eq(schema.teamsIntegrations.id, row.integrationId))
        .limit(1);
      if (!integration || !integration.active) throw new TerminalDeliveryError('integration_inactive');
      const creds = await teamsBotCredentials(this.db, integration);
      if (!creds) throw new TerminalDeliveryError('credentials_missing');

      const [eventRow] = await this.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, row.eventId))
        .limit(1);
      if (!eventRow) throw new TerminalDeliveryError('event_missing');

      const routes = await this.db
        .select()
        .from(schema.teamsChannelRoutes)
        .where(eq(schema.teamsChannelRoutes.integrationId, integration.id));
      const teams = await this.db
        .select()
        .from(schema.teamsInstalledTeams)
        .where(eq(schema.teamsInstalledTeams.integrationId, integration.id));

      await this.handleEvent({ row, integration, payload: eventRow.payload, creds, routes, teams });
      await this.finish(row, null);
      return 'delivered';
    } catch (err) {
      if (err instanceof TerminalDeliveryError) {
        await this.finish(row, err.message);
      } else if (err instanceof TeamsThrottledError) {
        await this.defer(row, err.retryAfterMs, err);
      } else if (err instanceof TeamsApiError && err.status === 429) {
        await this.defer(row, err.retryAfterMs ?? DEFAULT_THROTTLE_MS, err);
      } else if (err instanceof TeamsApiError && err.terminal) {
        await this.finish(row, describeError(err));
      } else {
        await this.recordFailure(row, err);
      }
      return 'failed';
    }
  }

  private async handleEvent(input: DeliveryInput): Promise<void> {
    const { row, payload, routes, teams, creds } = input;
    if (!row.conversationId) return;
    const context = await this.reader.loadConversation(row.conversationId);
    if (!context) throw new TerminalDeliveryError('conversation_missing');

    const mirrorRoute =
      routes.find((r) => r.convChannelId === context.conversation.channelId) ??
      routes.find((r) => r.purpose === 'default' && !r.convChannelId);
    if (!mirrorRoute) throw new TerminalDeliveryError('no_default_route');
    const mirror = this.target(mirrorRoute, teams);
    const escalationRoute = routes.find((r) => r.purpose === 'escalations' && !r.convChannelId);
    const escalation = escalationRoute ? this.target(escalationRoute, teams) : mirror;

    const link = await this.ensureLink(input.integration, mirror, context, creds);

    switch (row.eventType) {
      case 'conversation.created':
        return;
      case 'conversation.subject_changed':
        return await this.syncParent(link, context, creds);
      case 'conversation.message.received':
      case 'conversation.message.sent':
        return await this.mirrorMessage({ row, payload, context, link, creds });
      case 'conversation.message.body_revised':
        return await this.reviseMirroredMessage({ payload, context, link, creds });
      case 'conversation.handover_requested': {
        const reason = typeof payload.reason === 'string' ? payload.reason : null;
        await this.api.createChannelThread({
          creds,
          serviceUrl: escalation.team.serviceUrl,
          channelId: escalation.route.teamsChannelId,
          tenantId: escalation.team.tenantId,
          activity: htmlActivity(escalationAlertHtml(context.snapshot, reason)),
        });
        await this.syncParent(link, context, creds);
        return await this.postThreadReply(creds, link, handoverRequestedHtml(reason));
      }
      case 'conversation.handover_resolved':
        await this.syncParent(link, context, creds);
        return await this.postThreadReply(creds, link, handoverResolvedHtml());
      case 'conversation.status_changed': {
        const status = typeof payload.status === 'string' ? payload.status : 'unknown';
        await this.syncParent(link, context, creds);
        return await this.postThreadReply(creds, link, statusChangedHtml(status));
      }
      case 'conversation.assigned': {
        const assigneeUserId =
          typeof payload.assigneeUserId === 'string' ? payload.assigneeUserId : null;
        const name = assigneeUserId ? await this.reader.userName(assigneeUserId) : null;
        await this.syncParent(link, context, creds);
        return await this.postThreadReply(creds, link, assignedHtml(name));
      }
      case 'conversation.taken_over': {
        const name = await this.reader.holderName(payload);
        await this.syncParent(link, context, creds);
        return await this.postThreadReply(creds, link, takenOverHtml(name));
      }
      case 'conversation.released': {
        const name = await this.reader.holderName(payload);
        await this.syncParent(link, context, creds);
        return await this.postThreadReply(creds, link, releasedHtml(name));
      }
      default:
        return;
    }
  }

  private target(route: RouteRow, teams: InstalledTeamRow[]): Target {
    const team = teams.find((t) => t.id === route.installedTeamId);
    if (!team || !team.installed) throw new TerminalDeliveryError('bot_not_installed');
    return { route, team };
  }

  private async mirrorMessage(input: {
    row: DeliveryRow;
    payload: Record<string, unknown>;
    context: BridgeConversationContext;
    link: LinkRow;
    creds: TeamsBotCredentials;
  }): Promise<void> {
    const { row, payload, context, link, creds } = input;
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
    if (!messageId) return;
    const [existing] = await this.db
      .select({ id: schema.teamsMessageLinks.id })
      .from(schema.teamsMessageLinks)
      .where(eq(schema.teamsMessageLinks.messageId, messageId))
      .limit(1);
    if (existing) return;

    const [message] = await this.db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.id, messageId))
      .limit(1);
    if (!message) throw new TerminalDeliveryError('message_missing');

    const snapshot = await this.reader.messageSnapshot(message, context);
    const posted = await this.api.sendToConversation({
      creds,
      serviceUrl: link.serviceUrl,
      conversationId: threadConversationId(link.teamsChannelId, link.rootActivityId),
      activity: htmlActivity(messageHtml(snapshot)),
    });
    await this.db
      .insert(schema.teamsMessageLinks)
      .values({
        orgId: row.orgId,
        conversationId: message.conversationId,
        messageId,
        teamsChannelId: link.teamsChannelId,
        activityId: posted.activityId,
        origin: 'mirrored',
      })
      .onConflictDoNothing();
  }

  private async reviseMirroredMessage(input: {
    payload: Record<string, unknown>;
    context: BridgeConversationContext;
    link: LinkRow;
    creds: TeamsBotCredentials;
  }): Promise<void> {
    const { payload, context, link, creds } = input;
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
    if (!messageId) return;
    const [messageLink] = await this.db
      .select()
      .from(schema.teamsMessageLinks)
      .where(eq(schema.teamsMessageLinks.messageId, messageId))
      .limit(1);
    if (!messageLink || messageLink.origin !== 'mirrored') return;
    const [message] = await this.db
      .select()
      .from(schema.convMessages)
      .where(eq(schema.convMessages.id, messageId))
      .limit(1);
    if (!message) throw new TerminalDeliveryError('message_missing');
    const snapshot = await this.reader.messageSnapshot(message, context);
    try {
      await this.api.updateActivity({
        creds,
        serviceUrl: link.serviceUrl,
        conversationId: threadConversationId(link.teamsChannelId, link.rootActivityId),
        activityId: messageLink.activityId,
        activity: htmlActivity(messageHtml(snapshot)),
      });
    } catch (err) {
      if (err instanceof TeamsApiError && err.status === 404) {
        throw new TerminalDeliveryError('teams_message_missing');
      }
      throw err;
    }
  }

  private async ensureLink(
    integration: IntegrationRow,
    mirror: Target,
    context: BridgeConversationContext,
    creds: TeamsBotCredentials,
  ): Promise<LinkRow> {
    const [existing] = await this.db
      .select()
      .from(schema.teamsConversationLinks)
      .where(eq(schema.teamsConversationLinks.conversationId, context.conversation.id))
      .limit(1);
    if (existing) return existing;

    const state = await this.reader.loadParentState(context);
    const posted = await this.api.createChannelThread({
      creds,
      serviceUrl: mirror.team.serviceUrl,
      channelId: mirror.route.teamsChannelId,
      tenantId: mirror.team.tenantId,
      activity: threadParentActivity(context.snapshot, state, context.conversation.id),
    });
    const [inserted] = await this.db
      .insert(schema.teamsConversationLinks)
      .values({
        orgId: integration.orgId,
        integrationId: integration.id,
        conversationId: context.conversation.id,
        teamsChannelId: mirror.route.teamsChannelId,
        rootActivityId: posted.activityId,
        serviceUrl: mirror.team.serviceUrl,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    const [reread] = await this.db
      .select()
      .from(schema.teamsConversationLinks)
      .where(eq(schema.teamsConversationLinks.conversationId, context.conversation.id))
      .limit(1);
    if (!reread) throw new Error('teams_conversation_link_vanished');
    return reread;
  }

  private async syncParent(
    link: LinkRow,
    context: BridgeConversationContext,
    creds: TeamsBotCredentials,
  ): Promise<void> {
    const state = await this.reader.loadParentState(context);
    await this.updateParent(link, threadParentActivity(context.snapshot, state, context.conversation.id), creds);
  }

  private async updateParent(
    link: LinkRow,
    activity: TeamsActivity,
    creds: TeamsBotCredentials,
  ): Promise<void> {
    try {
      await this.api.updateActivity({
        creds,
        serviceUrl: link.serviceUrl,
        conversationId: threadConversationId(link.teamsChannelId, link.rootActivityId),
        activityId: link.rootActivityId,
        activity,
      });
    } catch (err) {
      if (!(err instanceof TeamsApiError) || err.status !== 404) throw err;
      await this.db
        .delete(schema.teamsConversationLinks)
        .where(eq(schema.teamsConversationLinks.id, link.id));
      throw new TerminalDeliveryError('teams_thread_missing');
    }
  }

  private async postThreadReply(creds: TeamsBotCredentials, link: LinkRow, html: string): Promise<void> {
    await this.api.sendToConversation({
      creds,
      serviceUrl: link.serviceUrl,
      conversationId: threadConversationId(link.teamsChannelId, link.rootActivityId),
      activity: htmlActivity(html),
    });
  }

  private async finish(row: DeliveryRow, error: string | null): Promise<void> {
    await this.db
      .update(schema.teamsDeliveries)
      .set({ attempt: row.attempt + 1, deliveredAt: new Date(), nextAttemptAt: null, error })
      .where(eq(schema.teamsDeliveries.id, row.id));
  }

  private async defer(row: DeliveryRow, delayMs: number, err: unknown): Promise<void> {
    await this.db
      .update(schema.teamsDeliveries)
      .set({ error: describeError(err), nextAttemptAt: new Date(Date.now() + delayMs) })
      .where(eq(schema.teamsDeliveries.id, row.id));
  }

  private async recordFailure(row: DeliveryRow, err: unknown): Promise<void> {
    const nextAttempt = row.attempt + 1;
    const final = nextAttempt >= MAX_ATTEMPTS;
    const backoff = BACKOFF_BASE_MS * 2 ** row.attempt;
    const jitter = Math.floor(backoff * 0.1 * Math.random());
    await this.db
      .update(schema.teamsDeliveries)
      .set({
        attempt: nextAttempt,
        error: describeError(err),
        nextAttemptAt: final ? null : new Date(Date.now() + backoff + jitter),
        deliveredAt: final ? new Date() : null,
      })
      .where(eq(schema.teamsDeliveries.id, row.id));
  }
}

export { POLL_INTERVAL_MS as TEAMS_POLL_INTERVAL_MS };
