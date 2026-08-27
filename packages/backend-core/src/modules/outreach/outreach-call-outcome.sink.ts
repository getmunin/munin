import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, type EmittedEvent, type EventSink } from '@getmunin/core';
import { CuratorJobsService } from '../curator/curator-jobs.service.ts';
import { buildCallOutcomePrompt } from './call-outcome-job.ts';

export const CALL_OUTCOME_JOB_URI = 'skill://outreach/extract-call-outcome';

const VOICE_CALL_ENDED = 'conversation.voice.call_ended';

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
export class OutreachCallOutcomeSink implements EventSink {
  constructor(@Inject(CuratorJobsService) private readonly curatorJobs: JobEnqueuer) {}

  async onEvent(event: EmittedEvent): Promise<void> {
    if (event.type !== VOICE_CALL_ENDED) return;
    const conversationId =
      typeof event.payload.conversationId === 'string' ? event.payload.conversationId : null;
    if (!conversationId) return;

    const ctx = getCurrentContext();
    const [conversation] = await ctx.db
      .select({
        outreachCampaignId: schema.convConversations.outreachCampaignId,
        metadata: schema.convConversations.metadata,
      })
      .from(schema.convConversations)
      .where(eq(schema.convConversations.id, conversationId))
      .limit(1);
    if (!conversation?.outreachCampaignId) return;

    const contactId = conversation.metadata.crmContactId;
    if (typeof contactId !== 'string' || !contactId) return;

    const [campaign] = await ctx.db
      .select({ extractionSchema: schema.outreachCampaigns.extractionSchema })
      .from(schema.outreachCampaigns)
      .where(eq(schema.outreachCampaigns.id, conversation.outreachCampaignId))
      .limit(1);
    const extractionSchema = campaign?.extractionSchema ?? [];
    if (extractionSchema.length === 0) return;

    await this.curatorJobs.enqueue({
      jobUri: CALL_OUTCOME_JOB_URI,
      userPrompt: buildCallOutcomePrompt({
        conversationId,
        campaignId: conversation.outreachCampaignId,
        contactId,
        extractionSchema,
      }),
      sourceEventType: VOICE_CALL_ENDED,
      sourceEventPayload: event.payload,
      dedupeKey: `outreach-call-outcome:conv:${conversationId}`,
    });
  }
}
