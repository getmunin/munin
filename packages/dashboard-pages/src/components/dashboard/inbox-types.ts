import type { ApiError } from '../../api';
import type { RealtimeStatus } from '../../realtime';
import type {
  CmsAssetExpanded,
  CmsDraftDetailDto,
  CmsDraftSummaryDto,
  CrmMergeProposalDto,
  FeedbackOutboxDto,
  KbCandidateDto,
  OutreachProposalDto,
  QueueItem,
} from './queue-drawers/types';

export type { QueueItem };

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
  claim: { holderType: 'user' | 'agent'; holderId: string; expiresAt: string } | null;
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

export type ConvDrawer = { id: string; mode: 'simplified' | 'full' } | null;

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
    cms: CmsDraftSummaryDto[];
    feedback?: FeedbackOutboxDto[];
  };
}

export type ConvActionError =
  | { type: 'send' | 'takeOver' | 'release' | 'close'; conversationId: string; message: string }
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
  reply: string;
  setReply: (next: string) => void;
  draftEdit: string | null;
  setDraftEdit: (next: string | null) => void;
  kbBodies: Record<string, string>;
  cmsDetails: Record<string, CmsDraftDetailDto>;
  detailErrors: Record<string, string>;
  queueDetailErrors: Record<string, string>;
  reloadDetail: (id: string) => Promise<void>;
  reloadQueueDetail: (id: string) => void;
  actionError: ConvActionError;
  clearActionError: () => void;
  connectionStatus: RealtimeStatus;
  takeOver: (id: string, openFullAfter?: boolean) => Promise<void>;
  release: (id: string) => Promise<void>;
  closeConv: (id: string) => Promise<void>;
  send: (id: string, body: string, options?: { claim?: boolean; closeDrawer?: boolean }) => Promise<void>;
  approveQueue: (item: QueueItem) => Promise<void>;
  saveQueue: (item: QueueItem, body: string) => Promise<void>;
  saveCmsDraft: (item: QueueItem, data: Record<string, unknown>) => Promise<void>;
  uploadCmsAsset: (item: QueueItem, file: File) => Promise<CmsAssetExpanded>;
  dismissQueue: (item: QueueItem) => Promise<void>;
  scheduleQueue: (item: QueueItem, scheduledAt: string) => Promise<void>;
}
