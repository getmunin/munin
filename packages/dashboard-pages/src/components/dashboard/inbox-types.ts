import type { ApiError } from '../../api';
import type { RealtimeStatus } from '../../realtime';
import type {
  CmsAssetExpanded,
  CmsDraftDetailDto,
  CmsDraftSummaryDto,
  CmsScheduledSummaryDto,
  CrmMergeProposalDto,
  FeedbackOutboxDto,
  KbCandidateDto,
  OutreachProposalDto,
  QueueItem,
  ScheduledItem,
} from './queue-drawers/types';

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

export type ConvDrawer = { id: string; title?: string } | null;

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

export type ConvActionError =
  | {
      type: 'send' | 'takeOver' | 'release' | 'close';
      conversationId: string;
      message: string;
      code: string | null;
    }
  | null;

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
  details: Record<string, ConversationDetail>;
  queue: QueueItem[];
  pending: boolean;
  loadError: ApiError | null;
  hasLoadedOnce: boolean;
  retrying: boolean;
  retryLoad: () => Promise<void>;
  convDrawer: ConvDrawer;
  setConvDrawer: (next: ConvDrawer) => void;
  queueDrawer: QueueItem | null;
  setQueueDrawer: (next: QueueItem | null) => void;
  scheduledDrawer: ScheduledItem | null;
  setScheduledDrawer: (next: ScheduledItem | null) => void;
  cancelTarget: ScheduledItem | null;
  setCancelTarget: (next: ScheduledItem | null) => void;
  reply: string;
  setReply: (next: string) => void;
  kbBodies: Record<string, string>;
  kbRevisedBodies: Record<string, string>;
  cmsDetails: Record<string, CmsDraftDetailDto>;
  detailErrors: Record<string, string>;
  queueDetailErrors: Record<string, string>;
  reloadDetail: (id: string) => Promise<void>;
  reloadQueueDetail: (id: string) => void;
  actionError: ConvActionError;
  clearActionError: () => void;
  queueActionError: QueueActionError;
  clearQueueActionError: () => void;
  connectionStatus: RealtimeStatus;
  takeOver: (id: string, openDrawerAfter?: boolean) => Promise<void>;
  release: (id: string) => Promise<void>;
  closeConv: (id: string) => Promise<void>;
  send: (
    id: string,
    body: string,
    options?: { claim?: boolean; fromDraftId?: string },
  ) => Promise<void>;
  approveQueue: (item: QueueItem, sendAt?: string | null) => Promise<boolean>;
  scheduled: ScheduledItem[];
  cancelScheduledSend: (id: string, reason: string) => Promise<void>;
  cancelScheduledPublish: (id: string) => Promise<void>;
  saveQueue: (item: QueueItem, body: string) => Promise<void>;
  saveCmsDraft: (item: QueueItem, data: Record<string, unknown>) => Promise<void>;
  uploadCmsAsset: (item: QueueItem, file: File) => Promise<CmsAssetExpanded>;
  previewCmsDraft: (item: QueueItem) => Promise<void>;
  dismissQueue: (item: QueueItem) => Promise<boolean>;
  scheduleQueue: (item: QueueItem, scheduledAt: string) => Promise<void>;
}
