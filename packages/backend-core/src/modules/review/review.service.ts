import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  KbService,
  type CurationCandidateSummary,
  type CurationDecisionDto,
} from '../kb/kb.service.ts';
import { CrmService, type MergeProposalDto } from '../crm/crm.service.ts';
import { OutreachService, type ProposalSummaryDto } from '../outreach/outreach.service.ts';
import {
  CmsService,
  type CmsDraftEntrySummary,
  type CmsScheduledEntrySummary,
} from '../cms/cms.service.ts';
import { FeedbackService, type FeedbackOutboxDto } from '../feedback/feedback.service.ts';
import {
  type DecidedCursor,
  type ReviewDecisionActor,
  type ReviewDecisionOutcome,
  type ReviewProducedRef,
} from '../../common/review-decision.ts';

export const REVIEW_DEFAULT_LIMIT = 50;

export type ReviewKind = 'kb' | 'crm' | 'outreach' | 'cms' | 'feedback';
export type ReviewState = 'waiting' | 'scheduled' | 'decided';

export interface ReviewDecidedFields {
  outcome: ReviewDecisionOutcome;
  reason: string | null;
  decidedBy: ReviewDecisionActor;
  producedRef: ReviewProducedRef | null;
}

type Item<K extends ReviewKind, Raw> = {
  kind: K;
  state: ReviewState;
  id: string;
  at: string;
  raw: Raw;
} & Partial<ReviewDecidedFields>;

export type ReviewItem =
  | Item<'kb', CurationCandidateSummary | CurationDecisionDto>
  | Item<'crm', MergeProposalDto>
  | Item<'outreach', ProposalSummaryDto>
  | Item<'cms', CmsDraftEntrySummary>
  | Item<'feedback', FeedbackOutboxDto>;

export interface DecidedPage {
  items: ReviewItem[];
  nextCursor: DecidedCursor | null;
}

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

  async listDecided(input: {
    cursor?: DecidedCursor;
    limit?: number;
  }): Promise<DecidedPage> {
    const limit = Math.min(Math.max(input.limit ?? REVIEW_DEFAULT_LIMIT, 1), 200);
    const query = { ...(input.cursor ? { cursor: input.cursor } : {}), limit: limit + 1 };

    const [kb, crm, outreach, cms, feedback] = await Promise.all([
      this.kb.listDecided(query),
      this.crm.listDecided(query),
      this.outreach.listDecided(query),
      this.cms.listDecided(query),
      this.feedback ? this.feedback.listDecided(query) : Promise.resolve([]),
    ]);

    const merged: ReviewItem[] = [
      ...kb.map((d) => decidedItem('kb', d)),
      ...crm.map((d) => decidedItem('crm', d)),
      ...outreach.map((d) => decidedItem('outreach', d)),
      ...cms.map((d) => decidedItem('cms', d)),
      ...feedback.map((d) => decidedItem('feedback', d)),
    ].sort((a, b) => millis(b.at) - millis(a.at) || (a.id < b.id ? 1 : -1));

    const items = merged.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        merged.length > limit && last ? { decidedAt: last.at, id: last.id } : null,
    };
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

function decidedItem<K extends ReviewKind, Raw>(
  kind: K,
  decision: { id: string; decidedAt: string; raw: Raw } & ReviewDecidedFields,
): Item<K, Raw> {
  return {
    kind,
    state: 'decided',
    id: decision.id,
    at: decision.decidedAt,
    outcome: decision.outcome,
    reason: decision.reason,
    decidedBy: decision.decidedBy,
    producedRef: decision.producedRef,
    raw: decision.raw,
  };
}
