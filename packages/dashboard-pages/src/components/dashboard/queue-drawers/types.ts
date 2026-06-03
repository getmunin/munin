export interface KbCandidateDto {
  id: string;
  title: string;
  body?: string;
  updatedAt: string;
  proposedTargetSpaceSlug: string | null;
}

export interface CrmContactSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface CrmMergeProposalDto {
  id: string;
  contactA: CrmContactSummary;
  contactB: CrmContactSummary;
  confidence: 'high' | 'medium';
  recommendedKeeperId: string;
  evidence?: Record<string, unknown>;
  createdAt: string;
}

export interface OutreachProposalDto {
  id: string;
  campaignId: string;
  contactId: string;
  conversationId: string | null;
  kind: 'initial' | 'reply';
  draftSubject: string | null;
  draftBody: string;
  campaign?: { name: string } | null;
  contact?: { name: string | null; email: string | null } | null;
  evidence?: Record<string, unknown>;
  createdAt: string;
}

export interface FeedbackOutboxDto {
  id: string;
  title: string;
  body: string;
  appScope: string | null;
  includeOrgName: boolean;
  includeUserName: boolean;
  submittedByUserId: string | null;
  createdAt: string;
  approvedAt: string | null;
  forwardError: string | null;
}

export interface CmsDraftSummaryDto {
  id: string;
  collectionId: string;
  collectionSlug: string;
  collectionName: string;
  slug: string;
  locale: string;
  title: string | null;
  wordCount: number | null;
  version: number;
  updatedAt: string;
}

export interface CmsAssetExpanded {
  id: string;
  publicUrl: string;
  altText: string | null;
}

export interface CmsDraftDetailDto {
  id: string;
  collectionId: string;
  collectionSlug: string;
  slug: string;
  locale: string;
  status: 'draft' | 'published' | 'scheduled' | 'archived';
  version: number;
  data: Record<string, unknown>;
  updatedAt: string;
}

export type QueueItem =
  | { kind: 'kb'; id: string; title: string; snippet: string; createdAt: string; raw: KbCandidateDto }
  | { kind: 'crm'; id: string; title: string; snippet: string; createdAt: string; raw: CrmMergeProposalDto }
  | { kind: 'outreach'; id: string; title: string; snippet: string; createdAt: string; raw: OutreachProposalDto }
  | { kind: 'cms'; id: string; title: string; snippet: string; createdAt: string; raw: CmsDraftSummaryDto }
  | { kind: 'feedback'; id: string; title: string; snippet: string; createdAt: string; raw: FeedbackOutboxDto };

export type QueueTone = 'kb' | 'crm' | 'out' | 'feedback' | 'cms';
export type QueueLabelKey =
  | 'kindKb'
  | 'kindCrm'
  | 'kindOutreach'
  | 'kindFeedback'
  | 'kindCms';

export function queueTone(item: QueueItem): QueueTone {
  if (item.kind === 'outreach') return 'out';
  if (item.kind === 'feedback') return 'feedback';
  if (item.kind === 'cms') return 'cms';
  return item.kind;
}

export function queueLabelKey(item: QueueItem): QueueLabelKey {
  if (item.kind === 'outreach') return 'kindOutreach';
  if (item.kind === 'kb') return 'kindKb';
  if (item.kind === 'feedback') return 'kindFeedback';
  if (item.kind === 'cms') return 'kindCms';
  return 'kindCrm';
}

export function readStringField(
  data: Record<string, unknown> | undefined,
  field: string,
): string | null {
  if (!data) return null;
  const v = data[field];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function readBodyFromCmsData(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const body = data['body'];
  return typeof body === 'string' ? body : '';
}

export function readCoverImage(
  data: Record<string, unknown> | undefined,
): CmsAssetExpanded | null {
  if (!data) return null;
  const v = data['cover_image'];
  if (!v || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  const id = typeof obj['id'] === 'string' ? obj['id'] : null;
  const publicUrl = typeof obj['publicUrl'] === 'string' ? obj['publicUrl'] : null;
  if (!id || !publicUrl) return null;
  const altText = typeof obj['altText'] === 'string' ? obj['altText'] : null;
  return { id, publicUrl, altText };
}
