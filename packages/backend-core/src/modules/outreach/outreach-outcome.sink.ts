import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { buildOutcomePrompt } from './outcome-job.ts';

export const OUTCOME_JOB_URI = 'skill://outreach/extract-outcome';

const VOICE_CALL_ENDED = 'conversation.voice.call_ended';
const MESSAGE_RECEIVED = 'conversation.message.received';

const REPLY_CHANNEL_TYPES: readonly string[] = ['email', 'sms'];

export interface JobEnqueuer {
  enqueue(input: {
    jobUri: string;
    userPrompt: string;
    sourceEventType?: string;
    sourceEventPayload?: unknown;
    dedupeKey?: string;
  }): Promise<unknown>;
}

@Injectable()
export class OutreachOutcomeSink implements EventSink {
  constructor(@Inject(CuratorJobsService) private readonly curatorJobs: JobEnqueuer) {}

  async onEvent(event: EmittedEvent): Promise<void> {
    if (event.type !== VOICE_CALL_ENDED && event.type !== MESSAGE_RECEIVED) return;
    const conversationId =
      typeof event.payload.conversationId === 'string' ? event.payload.conversationId : null;
    if (!conversationId) return;
    if (event.type === MESSAGE_RECEIVED && event.payload.authorType !== 'end_user') return;

    const ctx = getCurrentContext();
    const [conversation] = await ctx.db
      .select({
        outreachCampaignId: schema.convConversations.outreachCampaignId,
        channelType: schema.convChannels.type,
      })
      .from(schema.convConversations)
      .innerJoin(
        schema.convChannels,
        eq(schema.convChannels.id, schema.convConversations.channelId),
      )
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    if (!conversation?.outreachCampaignId) return;

    if (event.type === MESSAGE_RECEIVED) {
      if (!REPLY_CHANNEL_TYPES.includes(conversation.channelType)) return;
    } else if (conversation.channelType !== 'voice') {
      return;
    }

    const [campaign] = await ctx.db
      .select({ extractionSchema: schema.outreachCampaigns.extractionSchema })
      .from(schema.outreachCampaigns)
      .where(eq(schema.outreachCampaigns.id, conversation.outreachCampaignId))
      .limit(1);
    const extractionSchema = campaign?.extractionSchema ?? [];
    if (extractionSchema.length === 0) return;

    const [proposal] = await ctx.db
      .select({ contactId: schema.outreachProposals.contactId })
      .from(schema.outreachProposals)
      .where(
        and(
          eq(schema.outreachProposals.conversationId, conversationId),
          eq(schema.outreachProposals.campaignId, conversation.outreachCampaignId),
        ),
      )
      .limit(1);
    if (!proposal) return;

    const messageId =
      event.type === MESSAGE_RECEIVED && typeof event.payload.messageId === 'string'
        ? event.payload.messageId
        : null;

    await this.curatorJobs.enqueue({
      jobUri: OUTCOME_JOB_URI,
      userPrompt: buildOutcomePrompt({
        conversationId,
        campaignId: conversation.outreachCampaignId,
        contactId: proposal.contactId,
        channelType: conversation.channelType,
        extractionSchema,
      }),
      sourceEventType: event.type,
      sourceEventPayload: event.payload,
      dedupeKey: messageId
        ? `outreach-outcome:msg:${messageId}`
        : `outreach-outcome:conv:${conversationId}`,
    });
  }
}
