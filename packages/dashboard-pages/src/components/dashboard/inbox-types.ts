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
} from './queue-panes/types';

export type { QueueItem, ScheduledItem };

export type Status = 'open' | 'snoozed' | 'closed' | 'spam';

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
  attachments: unknown[];
  metadata: Record<string, unknown>;
  createdAt: string;
  seenAt?: string | null;
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

export interface InboxQueueResponse {
  live: LiveSummary[];
  queue: {
    kb: KbCandidateDto[];
    crm: CrmMergeProposalDto[];
    outreach: OutreachProposalDto[];
    outreachScheduled?: OutreachProposalDto[];
    cms: CmsDraftSummaryDto[];
    cmsScheduled?: CmsScheduledSummaryDto[];
    feedback?: FeedbackOutboxDto[];
  };
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
  scheduled: ScheduledItem[];
  cancelScheduledSend: (id: string, reason: string) => Promise<void>;
  cancelScheduledPublish: (id: string) => Promise<void>;
  saveQueue: (item: QueueItem, body: string) => Promise<void>;
  saveCmsDraft: (item: QueueItem, data: Record<string, unknown>) => Promise<void>;
  uploadCmsAsset: (item: QueueItem, file: File) => Promise<CmsAssetExpanded>;
  dismissQueue: (item: QueueItem) => Promise<boolean>;
  scheduleQueue: (item: QueueItem, scheduledAt: string) => Promise<void>;
}
