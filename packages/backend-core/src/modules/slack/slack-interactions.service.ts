import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@getmunin/db';
import { ActorIdentity, describeError, withContext, type RequestContext } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { ConvService } from '../conv/conv.service.ts';
import { ClaimedByOtherError, ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { SlackApiClient } from './slack-api.client.ts';
import { SlackUserMappingService } from './slack-user-mapping.service.ts';
import { SlackService, decryptSecretValue } from './slack.service.ts';
import {
  CLAIM_ACTION_ID,
  CLOSE_ACTION_ID,
  REOPEN_ACTION_ID,
  ROUTE_DEFAULT_ACTION_ID,
  ROUTE_DISMISS_ACTION_ID,
  ROUTE_ESCALATIONS_ACTION_ID,
  routeConfirmedText,
  routeDismissedText,
} from './slack-projection.ts';

const BlockActionsSchema = z.object({
  type: z.literal('block_actions'),
  user: z.object({ id: z.string().min(1) }),
  channel: z.object({ id: z.string().min(1) }).optional(),
  message: z.object({ ts: z.string().min(1) }).optional(),
  actions: z
    .array(z.object({ action_id: z.string().min(1), value: z.string().optional() }))
    .min(1),
});

const HANDLED_ACTIONS = new Set([CLAIM_ACTION_ID, CLOSE_ACTION_ID, REOPEN_ACTION_ID]);
const ROUTE_ACTIONS = new Set([
  ROUTE_DEFAULT_ACTION_ID,
  ROUTE_ESCALATIONS_ACTION_ID,
  ROUTE_DISMISS_ACTION_ID,
]);

/**
 * Button clicks on the thread parent, mapped onto the same service paths the
 * dashboard uses: Claim → ConversationClaimsService.claim, Close/Reopen →
 * ConvService.changeStatus. The resulting conversation events flow back
 * through the mirror worker, which posts the thread update and refreshes the
 * parent message — no state is written from here directly.
 */
@Injectable()
export class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SlackApiClient) private readonly api: SlackApiClient,
    @Inject(ConvService) private readonly conv: ConvService,
    @Inject(ConversationClaimsService) private readonly claims: ConversationClaimsService,
    @Inject(SlackUserMappingService) private readonly mapping: SlackUserMappingService,
    @Inject(SlackService) private readonly slack: SlackService,
  ) {}

  async processBlockActions(payload: Record<string, unknown>): Promise<void> {
    const parsed = BlockActionsSchema.safeParse(payload);
    if (!parsed.success) return;
    const routeAction = parsed.data.actions.find((a) => ROUTE_ACTIONS.has(a.action_id));
    if (routeAction?.value && parsed.data.channel) {
      await this.handleRoutePrompt({
        actionId: routeAction.action_id,
        integrationId: routeAction.value,
        slackChannelId: parsed.data.channel.id,
        slackUserId: parsed.data.user.id,
        promptTs: parsed.data.message?.ts ?? null,
      });
      return;
    }
    const action = parsed.data.actions.find((a) => HANDLED_ACTIONS.has(a.action_id));
    if (!action?.value) return;
    const conversationId = action.value;
    const slackUserId = parsed.data.user.id;

    const [link] = await this.db
      .select()
      .from(schema.slackConversationLinks)
      .where(eq(schema.slackConversationLinks.conversationId, conversationId))
      .limit(1);
    if (!link) return;
    if (parsed.data.channel && parsed.data.channel.id !== link.slackChannelId) return;

    const [integration] = await this.db
      .select()
      .from(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.id, link.integrationId))
      .limit(1);
    if (!integration || !integration.active) return;

    const token = await decryptSecretValue(this.db, integration.encryptedBotToken);
    const userId = await this.mapping.resolveMuninUser(integration, slackUserId, token);
    if (!userId) {
      await this.notify(
        token,
        link,
        slackUserId,
        ':no_entry: That action needs a linked Munin account — ask an admin to add you to the org with your Slack email.',
      );
      return;
    }

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
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        await withContext(ctx, async () => {
          switch (action.action_id) {
            case CLAIM_ACTION_ID:
              await this.claims.claim({ conversationId });
              return;
            case CLOSE_ACTION_ID:
              await this.conv.changeStatus({ id: conversationId, status: 'closed' });
              return;
            case REOPEN_ACTION_ID:
              await this.conv.changeStatus({ id: conversationId, status: 'open' });
              return;
            default:
              return;
          }
        });
      });
    } catch (err) {
      if (err instanceof ClaimedByOtherError) {
        await this.notify(
          token,
          link,
          slackUserId,
          ':raised_hand: Someone else already claimed this conversation.',
        );
        return;
      }
      this.logger.error(
        `slack action ${action.action_id} failed for ${conversationId}: ${describeError(err)}`,
      );
    }
  }

  private async handleRoutePrompt(input: {
    actionId: string;
    integrationId: string;
    slackChannelId: string;
    slackUserId: string;
    promptTs: string | null;
  }): Promise<void> {
    const [integration] = await this.db
      .select()
      .from(schema.slackIntegrations)
      .where(eq(schema.slackIntegrations.id, input.integrationId))
      .limit(1);
    if (!integration || !integration.active) return;

    const token = await decryptSecretValue(this.db, integration.encryptedBotToken);
    const ephemeral = (text: string) =>
      this.api
        .postEphemeral({ token, channel: input.slackChannelId, user: input.slackUserId, text })
        .catch((err: unknown) => this.logger.warn(`ephemeral notice failed: ${describeError(err)}`));

    const userId = await this.mapping.resolveMuninUser(integration, input.slackUserId, token);
    if (!userId) {
      await ephemeral(
        ':no_entry: That action needs a linked Munin account — ask an admin to add you to the org with your Slack email.',
      );
      return;
    }

    if (input.actionId === ROUTE_DISMISS_ACTION_ID) {
      if (input.promptTs) {
        await this.updatePrompt(token, input.slackChannelId, input.promptTs, routeDismissedText());
      }
      return;
    }

    const [membership] = await this.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(eq(schema.orgMembers.orgId, integration.orgId), eq(schema.orgMembers.userId, userId)),
      )
      .limit(1);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      await ephemeral(':no_entry: Only org owners and admins can change Slack routing.');
      return;
    }

    const purpose = input.actionId === ROUTE_ESCALATIONS_ACTION_ID ? 'escalations' : 'default';
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
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
        const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
        await withContext(ctx, () =>
          this.slack.setRouting({ slackChannelId: input.slackChannelId, purpose }),
        );
      });
    } catch (err) {
      if (err instanceof HttpException) {
        await ephemeral(`:no_entry: ${err.message}`);
        return;
      }
      this.logger.error(
        `slack route prompt ${input.actionId} failed for ${input.slackChannelId}: ${describeError(err)}`,
      );
      return;
    }

    if (input.promptTs) {
      await this.updatePrompt(
        token,
        input.slackChannelId,
        input.promptTs,
        routeConfirmedText(purpose, input.slackUserId),
      );
    }
  }

  private async updatePrompt(
    token: string,
    channel: string,
    ts: string,
    text: string,
  ): Promise<void> {
    try {
      await this.api.updateMessage({ token, channel, ts, text, blocks: [] });
    } catch (err) {
      this.logger.warn(`route prompt update failed: ${describeError(err)}`);
    }
  }

  private async notify(
    token: string,
    link: typeof schema.slackConversationLinks.$inferSelect,
    slackUserId: string,
    text: string,
  ): Promise<void> {
    try {
      await this.api.postEphemeral({
        token,
        channel: link.slackChannelId,
        user: slackUserId,
        threadTs: link.slackThreadTs,
        text,
      });
    } catch (err) {
      this.logger.warn(`ephemeral notice failed: ${describeError(err)}`);
    }
  }
}
