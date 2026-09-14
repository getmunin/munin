import type {
  QueueController,
  QueueItemDto,
} from '../components/dashboard/conversation-queue';
import type { ConversationDetail, MessageDto } from '../components/dashboard/inbox-types';

export const VIEWER_USER_ID = 'user_viewer';

const BASE_TIME = '2026-01-01T00:00:00.000Z';

export function makeMessage(overrides: Partial<MessageDto> & Pick<MessageDto, 'id'>): MessageDto {
  return {
    conversationId: 'conv_a',
    authorType: 'end_user',
    authorId: 'eu_1',
    authorName: 'Ada Customer',
    body: 'Where is my order?',
    internal: false,
    inReplyToId: null,
    attachments: [],
    metadata: {},
    createdAt: BASE_TIME,
    ...overrides,
  };
}

export function makeDraft(conversationId: string, id: string, body: string): MessageDto {
  return makeMessage({
    id,
    conversationId,
    authorType: 'agent',
    authorId: 'agent_1',
    authorName: 'Munin',
    body,
    internal: true,
    metadata: { kind: 'draft_reply' },
  });
}

export function makeDetail(
  id: string,
  overrides: Partial<ConversationDetail> = {},
): ConversationDetail {
  return {
    id,
    displayId: 1,
    status: 'open',
    channelId: 'chan_1',
    endUserId: 'eu_1',
    contactId: 'contact_1',
    topicId: null,
    assigneeUserId: null,
    subject: `Subject ${id}`,
    lastMessageAt: BASE_TIME,
    needsHumanAttention: false,
    needsHumanAttentionAt: null,
    isTest: false,
    updatedAt: BASE_TIME,
    createdAt: BASE_TIME,
    messages: [makeMessage({ id: `${id}_m1`, conversationId: id })],
    claim: { holderType: 'user', holderId: VIEWER_USER_ID, expiresAt: '2099-01-01T00:00:00.000Z' },
    contactEmail: 'ada@example.com',
    contactName: 'Ada Customer',
    contactPhone: null,
    ...overrides,
  };
}

export function makeItem(id: string, overrides: Partial<QueueItemDto> = {}): QueueItemDto {
  return {
    id,
    displayId: 1,
    status: 'open',
    channelId: 'chan_1',
    channelType: 'email',
    endUserId: 'eu_1',
    contactId: 'contact_1',
    topicId: null,
    assigneeUserId: null,
    subject: `Subject ${id}`,
    lastMessageAt: BASE_TIME,
    needsHumanAttention: false,
    needsHumanAttentionAt: null,
    agentMode: 'draft_only',
    customerName: 'Ada Customer',
    customerEmail: 'ada@example.com',
    customerPhone: null,
    topicName: null,
    topicSlug: null,
    topicAgentMode: null,
    claim: null,
    noteCount: 0,
    hasPendingDraft: false,
    ...overrides,
  };
}

export function stubController(overrides: Partial<QueueController> = {}): QueueController {
  return {
    open: [],
    finished: [],
    selectedId: null,
    details: {},
    detailErrors: {},
    retryDetail: () => Promise.resolve(),
    loadError: null,
    hasLoadedOnce: true,
    retrying: false,
    retryLoad: () => Promise.resolve(),
    pending: false,
    pendingAction: null,
    actionError: null,
    clearActionError: () => undefined,
    reportAttachmentError: () => undefined,
    draftRequested: {},
    takeOver: () => Promise.resolve(),
    release: () => Promise.resolve(true),
    closeConv: () => Promise.resolve(true),
    reopenConv: () => Promise.resolve(),
    send: () => Promise.resolve(true),
    deleteAttachment: () => Promise.resolve(true),
    retryDelivery: () => Promise.resolve(true),
    addNote: () => Promise.resolve(true),
    rejectDraft: () => Promise.resolve(),
    requestDraft: () => Promise.resolve(),
    ...overrides,
  };
}
