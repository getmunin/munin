import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';
import { ActorIdentity, describeError, withContext, type RequestContext } from '@getmunin/core';
import { DB } from '../../common/db/db.module.ts';
import { ClaimedByOtherError, ConversationClaimsService } from '../conv/conv.claims.service.ts';
import { ConvService } from '../conv/conv.service.ts';
import { BridgeConversationReader } from '../operator-bridge/bridge-conversation-reader.ts';
import { CardActionValueSchema, type TeamsInboundActivity } from './teams-activity.ts';
import { invokeMessage, threadParentActivity, type InvokeResponse } from './teams-projection.ts';
import { TeamsUserMappingService } from './teams-user-mapping.service.ts';
import { teamsBotCredentials } from './teams.service.ts';
import {
  TEAMS_CONVERSATION_VERBS,
  TEAMS_VERB_CLAIM,
  TEAMS_VERB_CLOSE,
  TEAMS_VERB_RELEASE,
  TEAMS_VERB_REOPEN,
  parseThreadConversationId,
} from './teams.constants.ts';

type IntegrationRow = typeof schema.teamsIntegrations.$inferSelect;

export interface ConversationStatusChanger {
  changeStatus(input: { id: string; status: 'open' | 'closed' }): Promise<unknown>;
}

export interface ConversationClaimer {
  claim(input: { conversationId: string }): Promise<unknown>;
  release(input: { conversationId: string }): Promise<unknown>;
}

@Injectable()
export class TeamsInteractionsService {
  private readonly logger = new Logger(TeamsInteractionsService.name);
  private readonly reader: BridgeConversationReader;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ConvService) private readonly conv: ConversationStatusChanger,
    @Inject(ConversationClaimsService) private readonly claims: ConversationClaimer,
    @Inject(TeamsUserMappingService) private readonly mapping: TeamsUserMappingService,
  ) {
    this.reader = new BridgeConversationReader(db);
  }

  async handleInvoke(
    integration: IntegrationRow,
    activity: TeamsInboundActivity,
  ): Promise<InvokeResponse> {
    if (activity.name !== 'adaptiveCard/action') return { status: 200, body: {} };
    const parsed = CardActionValueSchema.safeParse(activity.value);
    if (!parsed.success || !TEAMS_CONVERSATION_VERBS.includes(parsed.data.action.verb)) {
      return invokeMessage('This action is not supported.');
    }
    const verb = parsed.data.action.verb;
    const conversationId = parsed.data.action.data.conversationId;

    const [link] = await this.db
      .select()
      .from(schema.teamsConversationLinks)
      .where(eq(schema.teamsConversationLinks.conversationId, conversationId))
      .limit(1);
    const { channelId } = parseThreadConversationId(activity.conversation.id);
    if (!link || link.integrationId !== integration.id || link.teamsChannelId !== channelId) {
      return invokeMessage('This conversation is no longer mirrored here.');
    }

    const creds = await teamsBotCredentials(this.db, integration);
    const sender = activity.from;
    const userId =
      creds && sender
        ? await this.mapping.resolveMuninUser({
            integration,
            creds,
            serviceUrl: activity.serviceUrl,
            conversationId: activity.conversation.id,
            sender,
          })
        : null;
    if (!userId) {
      return invokeMessage(
        'That action needs a linked Munin account — ask an admin to invite you to the org with your work email.',
      );
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
          switch (verb) {
            case TEAMS_VERB_CLAIM:
              await this.claims.claim({ conversationId });
              return;
            case TEAMS_VERB_RELEASE:
              await this.claims.release({ conversationId });
              return;
            case TEAMS_VERB_CLOSE:
              await this.conv.changeStatus({ id: conversationId, status: 'closed' });
              return;
            case TEAMS_VERB_REOPEN:
              await this.conv.changeStatus({ id: conversationId, status: 'open' });
              return;
          }
        });
      });
    } catch (err) {
      if (err instanceof ClaimedByOtherError) {
        return invokeMessage(
          verb === TEAMS_VERB_RELEASE
            ? 'Only the person who took over this conversation can release it.'
            : 'Someone else has already taken over this conversation.',
        );
      }
      this.logger.error(`teams action ${verb} failed for ${conversationId}: ${describeError(err)}`);
      return invokeMessage('That action failed — try again from the Munin dashboard.');
    }

    const context = await this.reader.loadConversation(conversationId);
    if (!context) return invokeMessage('Done.');
    const state = await this.reader.loadParentState(context);
    const card = threadParentActivity(context.snapshot, state, conversationId).attachments![0]!.content;
    return {
      status: 200,
      body: { statusCode: 200, type: 'application/vnd.microsoft.card.adaptive', value: card },
    };
  }
}
