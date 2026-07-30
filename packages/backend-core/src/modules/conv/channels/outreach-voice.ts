import type { schema } from '@getmunin/db';

export const OUTREACH_VOICE_CALLERS = Symbol('OUTREACH_VOICE_CALLERS');

export interface OutreachCallContext {
  outreachCampaignId: string;
  outreachProposalId: string;
  contactId: string;
}

export interface PlaceOutreachCallInput {
  channel: typeof schema.convChannels.$inferSelect;
  toNumber: string;
  customerName?: string;
  opening: string;
  context: OutreachCallContext;
}

export interface OutreachVoiceCaller {
  readonly vendor: string;
  readonly callIdMetadataKey: string;
  placeOutreachCall(input: PlaceOutreachCallInput): Promise<{ callId: string; status: string }>;
}
