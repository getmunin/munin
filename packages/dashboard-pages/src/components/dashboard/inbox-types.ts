export interface MessageAttachment {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string | null;
  thumbnailUrl: string | null;
  deleted: boolean;
}

import type { ApiError } from '../../api';
import type {
  CmsAssetExpanded,
  CmsDraftDetailDto,
  CmsDraftSummaryDto,
  CmsPreviewLink,
  CmsScheduledSummaryDto,
  CrmMergeProposalDto,
  FeedbackOutboxDto,
  KbCandidateDto,
  OutreachProposalDetailDto,
  OutreachProposalDto,
  QueueItem,
  ScheduledItem,
  SocialDraftDto,
  SocialDraftEdit,
} from './queue-panes/types';

export type { QueueItem, ScheduledItem };

export type Status = 'open' | 'snoozed' | 'closed' | 'spam';

export type DeliveryStatus = 'queued' | 'sent' | 'failed' | 'dead';

export interface ConversationSummary {
  id: string;
  displayId: number;
  status: Status;
  channelId: string;
  endUserId: string | null;
  contactId: string | null;
  topicId: string | null;
  assigneeUserId: string | null;
  subject: string | null;
  lastMessageAt: string | null;
  needsHumanAttention: boolean;
  needsHumanAttentionAt: string | null;
  isTest?: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
  authorId: string;
  authorName: string | null;
  body: string;
  internal: boolean;
  inReplyToId: string | null;
  attachments: MessageAttachment[];
  metadata: Record<string, unknown>;
  createdAt: string;
  seenAt?: string | null;
  deliveryStatus?: DeliveryStatus | null;
  deliveryError?: string | null;
  deliveryAttempts?: number | null;
  deliveryNextAttemptAt?: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageDto[];
  claim: { holderType: 'user'; holderId: string; expiresAt: string } | null;
  contactEmail: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

export interface ActivityDto {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type LiveSummary = ConversationSummary & {
  latestEndUserMessage: { body: string; createdAt: string } | null;
  claim: ConversationDetail['claim'];
};

export type ReviewKind = 'kb' | 'crm' | 'outreach' | 'cms' | 'feedback' | 'social';

export interface CurationDecisionDto {
  id: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  candidateDocumentId: string;
  title: string;
  outcome: 'published' | 'dismissed';
  reason: string | null;
  publishedDocumentId: string | null;
  decidedByActorType: string;
  decidedByActorId: string;
  decidedByName: string | null;
  decidedAt: string;
}

export interface ReviewDecidedFields {
  outcome: 'approved' | 'dismissed' | 'failed';
  reason: string | null;
  decidedBy: { actorType: 'user' | 'agent'; actorId: string; name: string | null };
  producedRef: { type: string; id: string } | null;
}

type Wire<K extends ReviewKind, Raw, Extra = unknown> = {
  kind: K;
  state: 'waiting' | 'scheduled' | 'decided';
  id: string;
  at: string;
  raw: Raw;
} & Extra;

export type ReviewWireItem =
  | Wire<'kb', KbCandidateDto>
  | Wire<'crm', CrmMergeProposalDto>
  | Wire<'outreach', OutreachProposalDto>
  | Wire<'cms', CmsDraftSummaryDto | CmsScheduledSummaryDto>
  | Wire<'feedback', FeedbackOutboxDto>
  | Wire<'social', SocialDraftDto>;

export type ReviewDecidedWireItem =
  | Wire<'kb', CurationDecisionDto, ReviewDecidedFields>
  | Wire<'crm', CrmMergeProposalDto, ReviewDecidedFields>
  | Wire<'outreach', OutreachProposalDto, ReviewDecidedFields>
  | Wire<'cms', CmsDraftSummaryDto, ReviewDecidedFields>
  | Wire<'feedback', FeedbackOutboxDto, ReviewDecidedFields>
  | Wire<'social', SocialDraftDto, ReviewDecidedFields>;

export interface InboxQueueResponse {
  live: LiveSummary[];
  liveTotal: number;
  waiting: ReviewWireItem[];
  scheduled: ReviewWireItem[];
}

export type QueueActionError =
  | {
      type: 'approve' | 'dismiss';
      itemId: string;
      message: string;
      code: string | null;
    }
  | null;

export interface InboxController {
  items: LiveSummary[];
  itemsTotal: number;
  queue: QueueItem[];
  pending: boolean;
  loadError: ApiError | null;
  hasLoadedOnce: boolean;
  retrying: boolean;
  retryLoad: () => Promise<void>;
  activeQueueItem: QueueItem | null;
  setActiveQueueItem: (next: QueueItem | null) => void;
  activeScheduledItem: ScheduledItem | null;
  setActiveScheduledItem: (next: ScheduledItem | null) => void;
  cancelTarget: ScheduledItem | null;
  setCancelTarget: (next: ScheduledItem | null) => void;
  cmsDetails: Record<string, CmsDraftDetailDto>;
  outreachDetails: Record<string, OutreachProposalDetailDto>;
  cmsPreviewLinks: Record<string, CmsPreviewLink>;
  reloadCmsPreviewLink: (id: string) => Promise<void>;
  queueDetailErrors: Record<string, string>;
  reloadQueueDetail: (id: string) => void;
  queueActionError: QueueActionError;
  clearQueueActionError: () => void;
  approveQueue: (item: QueueItem, sendAt?: string | null) => Promise<boolean>;
  publishQueue: (item: QueueItem) => Promise<boolean>;
  scheduled: ScheduledItem[];
  cancelScheduledSend: (id: string, reason: string) => Promise<void>;
  cancelScheduledPublish: (id: string) => Promise<void>;
  saveQueue: (item: QueueItem, body: string) => Promise<void>;
  saveSocialDraft: (item: QueueItem, edit: SocialDraftEdit) => Promise<void>;
  saveCmsDraft: (item: QueueItem, data: Record<string, unknown>) => Promise<void>;
  uploadCmsAsset: (item: QueueItem, file: File) => Promise<CmsAssetExpanded>;
  dismissQueue: (item: QueueItem) => Promise<boolean>;
  scheduleQueue: (item: QueueItem, scheduledAt: string) => Promise<void>;
}
