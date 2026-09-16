import { Inject, Injectable, Optional } from '@nestjs/common';
import { KbService, type CurationCandidateSummary } from '../kb/kb.service.ts';
import { CrmService, type MergeProposalDto } from '../crm/crm.service.ts';
import { OutreachService, type ProposalSummaryDto } from '../outreach/outreach.service.ts';
import {
  CmsService,
  type CmsDraftEntrySummary,
  type CmsScheduledEntrySummary,
} from '../cms/cms.service.ts';
import { FeedbackService, type FeedbackOutboxDto } from '../feedback/feedback.service.ts';

export const REVIEW_DEFAULT_LIMIT = 50;

export type ReviewKind = 'kb' | 'crm' | 'outreach' | 'cms' | 'feedback';
export type ReviewState = 'waiting' | 'scheduled' | 'decided';

export type ReviewItem =
  | { kind: 'kb'; state: ReviewState; id: string; at: string; raw: CurationCandidateSummary }
  | { kind: 'crm'; state: ReviewState; id: string; at: string; raw: MergeProposalDto }
  | { kind: 'outreach'; state: ReviewState; id: string; at: string; raw: ProposalSummaryDto }
  | { kind: 'cms'; state: ReviewState; id: string; at: string; raw: CmsDraftEntrySummary }
  | { kind: 'feedback'; state: ReviewState; id: string; at: string; raw: FeedbackOutboxDto };

export interface ReviewSnapshot {
  kb: CurationCandidateSummary[];
  crm: MergeProposalDto[];
  outreach: ProposalSummaryDto[];
  outreachScheduled: ProposalSummaryDto[];
  cms: CmsDraftEntrySummary[];
  cmsScheduled: CmsScheduledEntrySummary[];
  feedback?: FeedbackOutboxDto[];
}

function millis(iso: string): number {
  const parsed = new Date(iso).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

@Injectable()
export class ReviewService {
  constructor(
    private readonly kb: KbService,
    private readonly crm: CrmService,
    private readonly outreach: OutreachService,
    private readonly cms: CmsService,
    @Optional() @Inject(FeedbackService) private readonly feedback: FeedbackService | null = null,
  ) {}

  async readSnapshot(limit: number = REVIEW_DEFAULT_LIMIT): Promise<ReviewSnapshot> {
    const [kb, crm, outreach, outreachScheduled, cms, cmsScheduled, feedback] = await Promise.all([
      this.kb.listCurationCandidates(limit),
      this.crm.listMergeProposals({ status: 'pending', limit }),
      this.outreach.listProposals({ status: 'pending', limit }),
      this.outreach.listProposals({ status: 'approved', limit }),
      this.cms.listDraftEntries(limit),
      this.cms.listScheduledEntries(limit),
      this.feedback ? this.feedback.listPending() : Promise.resolve(undefined),
    ]);

    return {
      kb,
      crm,
      outreach,
      outreachScheduled,
      cms,
      cmsScheduled,
      ...(feedback ? { feedback } : {}),
    };
  }

  hasPendingItems(snapshot: ReviewSnapshot): boolean {
    return (
      snapshot.kb.length > 0 ||
      snapshot.crm.length > 0 ||
      snapshot.outreach.length > 0 ||
      snapshot.cms.length > 0 ||
      snapshot.cmsScheduled.length > 0 ||
      (snapshot.feedback?.length ?? 0) > 0 ||
      snapshot.outreachScheduled.some((proposal) => proposal.scheduledSendAt !== null)
    );
  }

  async listWaiting(limit: number = REVIEW_DEFAULT_LIMIT): Promise<ReviewItem[]> {
    return this.selectWaiting(await this.readSnapshot(limit));
  }

  async listScheduled(limit: number = REVIEW_DEFAULT_LIMIT): Promise<ReviewItem[]> {
    return this.selectScheduled(await this.readSnapshot(limit));
  }

  selectWaiting(snapshot: ReviewSnapshot): ReviewItem[] {
    const items: ReviewItem[] = [
      ...snapshot.kb.map<ReviewItem>((raw) => ({
        kind: 'kb',
        state: 'waiting',
        id: raw.id,
        at: raw.updatedAt,
        raw,
      })),
      ...snapshot.crm.map<ReviewItem>((raw) => ({
        kind: 'crm',
        state: 'waiting',
        id: raw.id,
        at: raw.createdAt,
        raw,
      })),
      ...snapshot.outreach.map<ReviewItem>((raw) => ({
        kind: 'outreach',
        state: 'waiting',
        id: raw.id,
        at: raw.createdAt,
        raw,
      })),
      ...snapshot.cms.map<ReviewItem>((raw) => ({
        kind: 'cms',
        state: 'waiting',
        id: raw.id,
        at: raw.updatedAt,
        raw,
      })),
      ...(snapshot.feedback ?? []).map<ReviewItem>((raw) => ({
        kind: 'feedback',
        state: 'waiting',
        id: raw.id,
        at: raw.createdAt,
        raw,
      })),
    ];
    return items.sort((a, b) => millis(b.at) - millis(a.at));
  }

  selectScheduled(snapshot: ReviewSnapshot): ReviewItem[] {
    const items: ReviewItem[] = [
      ...snapshot.outreachScheduled.flatMap<ReviewItem>((raw) =>
        raw.scheduledSendAt
          ? [{ kind: 'outreach', state: 'scheduled', id: raw.id, at: raw.scheduledSendAt, raw }]
          : [],
      ),
      ...snapshot.cmsScheduled.map<ReviewItem>((raw) => ({
        kind: 'cms',
        state: 'scheduled',
        id: raw.id,
        at: raw.scheduledAt,
        raw,
      })),
    ];
    return items.sort((a, b) => millis(a.at) - millis(b.at));
  }
}
