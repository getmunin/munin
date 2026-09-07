export interface KbCandidateDto {
  id: string;
  title: string;
  body: string;
  version: number;
  updatedAt: string;
  proposedTargetSpaceSlug: string | null;
  sourceConversationId: string | null;
  revisesDocumentId: string | null;
  revisesDocumentTitle: string | null;
  revisesDocumentVersion: number | null;
  revisesDocumentBody: string | null;
}

export interface CrmContactSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  companyId?: string | null;
  companyName?: string | null;
  endUserId?: string | null;
  title?: string | null;
  address?: string | null;
  tags?: string[];
  customFields?: Record<string, unknown>;
  aiSummary?: string | null;
  aiNextAction?: string | null;
  engagementScore?: number;
  doNotContact?: boolean;
  unsubscribedAt?: string | null;
  lastContactedAt?: string | null;
  consentLawfulBasis?: string | null;
  consentSource?: string | null;
  createdAt?: string;
}

export interface CrmMergeImpact {
  duplicateId: string;
  pendingOutreach: Array<{
    id: string;
    campaignName: string | null;
    scheduledSendAt: string | null;
  }>;
  supersededProposalCount: number;
}

export interface CrmMergeProposalDto {
  mergeFingerprint: string;
  id: string;
  contactA: CrmContactSummary;
  contactB: CrmContactSummary;
  confidence: 'high' | 'medium';
  recommendedKeeperId: string;
  recommendedPatch?: Record<string, unknown>;
  impact?: CrmMergeImpact | null;
  evidence?: Record<string, unknown>;
  proposedByActorType?: string;
  createdAt: string;
}

export interface OutreachProposalDto {
  id: string;
  campaignId: string;
  contactId: string;
  conversationId: string | null;
  kind: 'initial' | 'reply' | 'followup';
  sequenceStep?: number | null;
  draftSubject: string | null;
  draftBody: string;
  originalDraftBody?: string | null;
  draftFingerprint: string;
  campaign?: { name: string; ctaUrl?: string | null } | null;
  contact?: {
    name: string | null;
    email: string | null;
    phone?: string | null;
    companyName?: string | null;
  } | null;
  delivery?: {
    channelType: string;
    vendor: string;
    destination: string | null;
    sender?: string | null;
    senderName?: string | null;
    appendsCta: boolean;
    appendsUnsubscribe: boolean;
  } | null;
  evidence?: Record<string, unknown>;
  hasEvidence?: boolean;
  revisionCount?: number;
  lastRevisionReason?: string | null;
  revisedAfterReviewAt?: string | null;
  proposedByActorType?: string;
  firstViewedAt?: string | null;
  proposedSendAt?: string | null;
  scheduledSendAt?: string | null;
  createdAt: string;
}

export type OutreachProposalDetailDto = OutreachProposalDto & {
  evidence: Record<string, unknown>;
};

export interface OutreachEvidence {
  prose: string[];
  kbRefs: string[];
  chips: Array<{ label: string; value: string }>;
}

const EVIDENCE_PROSE_KEYS = new Set(['reasoning', 'rationale', 'why', 'signal', 'summary']);
const EVIDENCE_KB_KEYS = new Set(['kbdocids', 'kbdocs', 'source', 'sources']);
const EVIDENCE_CHIP_MAX = 52;

export function readOutreachEvidence(
  evidence: Record<string, unknown> | undefined,
): OutreachEvidence | null {
  if (!evidence) return null;
  const prose: string[] = [];
  const kbRefs: string[] = [];
  const chips: Array<{ label: string; value: string }> = [];

  for (const [key, raw] of Object.entries(evidence)) {
    const lower = key.toLowerCase();
    for (const value of flattenScalars(raw)) {
      if (value.startsWith('kb://') || value.startsWith('kdoc_') || EVIDENCE_KB_KEYS.has(lower)) {
        kbRefs.push(value);
      } else if (EVIDENCE_PROSE_KEYS.has(lower) || value.length > EVIDENCE_CHIP_MAX) {
        prose.push(value);
      } else {
        chips.push({ label: humanizeFieldName(key), value });
      }
    }
  }

  if (prose.length === 0 && kbRefs.length === 0 && chips.length === 0) return null;
  return { prose, kbRefs, chips };
}

function flattenScalars(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.trim().length > 0 ? [raw.trim()] : [];
  if (typeof raw === 'number' || typeof raw === 'boolean') return [String(raw)];
  if (Array.isArray(raw)) return raw.flatMap(flattenScalars);
  return [];
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
  titleFieldName: string | null;
  wordCount: number | null;
  version: number;
  updatedAt: string;
}

export interface CmsScheduledSummaryDto extends CmsDraftSummaryDto {
  scheduledAt: string;
}

export interface CmsPreviewLink {
  url: string | null;
  deliveryUrl: string | null;
}

export interface CmsAssetExpanded {
  id: string;
  publicUrl: string;
  altText: string | null;
}

export type CmsFieldType =
  | 'text'
  | 'rich_text'
  | 'markdown'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi_select'
  | 'asset'
  | 'reference'
  | 'array'
  | 'blocks'
  | 'json';

export interface CmsBlockTypeDef {
  name: string;
  label?: string;
  description?: string;
  fields: CmsFieldDef[];
}

export interface CmsFieldDef {
  name: string;
  type: CmsFieldType;
  required?: boolean;
  localized?: boolean;
  description?: string;
  default?: unknown;
  options?: {
    choices?: string[];
    targetCollection?: string;
    items?: CmsFieldDef;
    blockTypes?: CmsBlockTypeDef[];
  };
}

export interface CmsBlockInstance {
  type: string;
  key?: string;
  props: Record<string, unknown>;
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
  assets?: Record<string, CmsAssetExpanded>;
  fields: CmsFieldDef[];
  updatedAt: string;
}

export type QueueItem =
  | { kind: 'kb'; id: string; title: string; snippet: string; createdAt: string; raw: KbCandidateDto }
  | { kind: 'crm'; id: string; title: string; snippet: string; createdAt: string; raw: CrmMergeProposalDto }
  | { kind: 'outreach'; id: string; title: string; snippet: string; createdAt: string; raw: OutreachProposalDto }
  | { kind: 'cms'; id: string; title: string; snippet: string; createdAt: string; raw: CmsDraftSummaryDto }
  | { kind: 'feedback'; id: string; title: string; snippet: string; createdAt: string; raw: FeedbackOutboxDto };

export type ScheduledItem =
  | {
      kind: 'outreach';
      id: string;
      title: string;
      snippet: string;
      at: string;
      raw: OutreachProposalDto;
    }
  | {
      kind: 'cms';
      id: string;
      title: string;
      snippet: string;
      at: string;
      raw: CmsScheduledSummaryDto;
    };

export type QueueCodeKey =
  | 'codeKb'
  | 'codeCrm'
  | 'codeOutreach'
  | 'codeFeedback'
  | 'codeCms';

export function queueCodeKey(kind: QueueItem['kind']): QueueCodeKey {
  if (kind === 'outreach') return 'codeOutreach';
  if (kind === 'kb') return 'codeKb';
  if (kind === 'feedback') return 'codeFeedback';
  if (kind === 'cms') return 'codeCms';
  return 'codeCrm';
}

export function readAssetField(
  data: Record<string, unknown> | undefined,
  field: string,
): CmsAssetExpanded | null {
  if (!data) return null;
  const v = data[field];
  if (!v || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  const id = typeof obj['id'] === 'string' ? obj['id'] : null;
  const publicUrl = typeof obj['publicUrl'] === 'string' ? obj['publicUrl'] : null;
  if (!id || !publicUrl) return null;
  const altText = typeof obj['altText'] === 'string' ? obj['altText'] : null;
  return { id, publicUrl, altText };
}

export function humanizeFieldName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function asBlock(value: unknown): CmsBlockInstance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  const key = (value as { key?: unknown }).key;
  const props = (value as { props?: unknown }).props;
  return {
    type,
    ...(typeof key === 'string' ? { key } : {}),
    props:
      props && typeof props === 'object' && !Array.isArray(props)
        ? (props as Record<string, unknown>)
        : {},
  };
}

export function blockTypeDef(field: CmsFieldDef, typeName: string): CmsBlockTypeDef | null {
  return field.options?.blockTypes?.find((t) => t.name === typeName) ?? null;
}

export function blockTypeLabel(blockType: CmsBlockTypeDef): string {
  return blockType.label ?? humanizeFieldName(blockType.name);
}
