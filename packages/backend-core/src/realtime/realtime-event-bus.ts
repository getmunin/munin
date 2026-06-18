import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from '@getmunin/db';
import { DB } from '../common/db/db.module.ts';
import { AGENT_TYPING_CHANNEL, DbListenerService, type EventRow } from './db-listener.service.ts';

export interface MessageReceivedBusEvent {
  conversationId: string;
  messageId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
  endUserId?: string;
}

export interface KbDocumentChangedBusEvent {
  type: 'created' | 'updated' | 'deleted';
  spaceId: string;
  documentId: string;
  slug: string | null;
  version?: number;
}

export interface HandoverResolvedBusEvent {
  conversationId: string;
  messageId: string;
  authorType: 'user' | 'agent' | 'end_user' | 'system';
}

export interface CuratorJobPendingBusEvent {
  jobId: string;
  jobUri: string;
  dedupeKey: string | null;
  nextAttemptAt: string;
}

export interface GreetRequestedBusEvent {
  conversationId: string;
  endUserId?: string;
}

export interface AgentConfigChangedBusEvent {
  configId: string;
}

export interface RealtimeBusHandlers {
  onMessageReceived?: (event: MessageReceivedBusEvent) => void;
  onKbDocumentChanged?: (event: KbDocumentChangedBusEvent) => void;
  onHandoverResolved?: (event: HandoverResolvedBusEvent) => void;
  onCuratorJobPending?: (event: CuratorJobPendingBusEvent) => void;
  onGreetRequested?: (event: GreetRequestedBusEvent) => void;
  onAgentConfigChanged?: (event: AgentConfigChangedBusEvent) => void;
  onConnected?: () => void;
}

export interface RealtimeBusSubscriptionFilter {
  orgId: string;
  endUserId?: string;
}

export interface RealtimeBusSubscription {
  unsubscribe(): void;
}

export interface AgentTypingBusEvent {
  orgId: string;
  conversationId: string;
  isTyping: boolean;
  authorType: 'visitor' | 'operator';
  originInstanceId?: string;
}

export type AgentTypingHandler = (event: AgentTypingBusEvent) => void;

@Injectable()
export class RealtimeEventBus {
  private readonly logger = new Logger(RealtimeEventBus.name);

  constructor(
    private readonly listener: DbListenerService,
    @Inject(DB) private readonly db: Db,
  ) {}

  subscribe(filter: RealtimeBusSubscriptionFilter, handlers: RealtimeBusHandlers): RealtimeBusSubscription {
    const dbUnsubscribe = this.listener.subscribe((event) => {
      if (event.org_id !== filter.orgId) return;
      if (filter.endUserId && !ownsEvent(event, filter.endUserId)) return;
      try {
        dispatchEvent(event, handlers);
      } catch (err) {
        this.logger.warn(`bus handler threw for ${event.type}: ${describe(err)}`);
      }
    });
    if (handlers.onConnected) {
      setImmediate(() => {
        try {
          handlers.onConnected?.();
        } catch (err) {
          this.logger.warn(`onConnected handler threw: ${describe(err)}`);
        }
      });
    }
    return { unsubscribe: dbUnsubscribe };
  }

  publishConversationTyping(
    orgId: string,
    conversationId: string,
    isTyping: boolean,
    opts?: { authorType?: 'visitor' | 'operator'; originInstanceId?: string },
  ): void {
    const payload = JSON.stringify({
      orgId,
      conversationId,
      isTyping,
      authorType: opts?.authorType ?? 'operator',
      originInstanceId: opts?.originInstanceId,
    } satisfies AgentTypingBusEvent);
    void this.db
      .execute(sql`SELECT pg_notify(${AGENT_TYPING_CHANNEL}, ${payload})`)
      .catch((err: unknown) => {
        this.logger.warn(`publishConversationTyping failed: ${describe(err)}`);
      });
  }

  subscribeAgentTyping(handler: AgentTypingHandler): () => void {
    return this.listener.subscribeTyping((notification) => {
      handler(notification satisfies AgentTypingBusEvent);
    });
  }
}

function dispatchEvent(event: EventRow, handlers: RealtimeBusHandlers): void {
  const payload = event.payload ?? {};
  const type = event.type;

  if (type === 'conversation.message.received' && handlers.onMessageReceived) {
    const conversationId = payload['conversationId'];
    const messageId = payload['messageId'];
    const authorType = payload['authorType'];
    if (typeof conversationId !== 'string' || typeof messageId !== 'string') return;
    handlers.onMessageReceived({
      conversationId,
      messageId,
      authorType:
        typeof authorType === 'string'
          ? (authorType as MessageReceivedBusEvent['authorType'])
          : 'end_user',
      endUserId: typeof payload['endUserId'] === 'string' ? payload['endUserId'] : undefined,
    });
    return;
  }

  if (type === 'conversation.handover_resolved' && handlers.onHandoverResolved) {
    const conversationId = payload['conversationId'];
    const messageId = payload['messageId'];
    const authorType = payload['authorType'];
    if (typeof conversationId !== 'string' || typeof messageId !== 'string') return;
    handlers.onHandoverResolved({
      conversationId,
      messageId,
      authorType:
        typeof authorType === 'string'
          ? (authorType as HandoverResolvedBusEvent['authorType'])
          : 'user',
    });
    return;
  }

  if (type === 'conversation.greet_requested' && handlers.onGreetRequested) {
    const conversationId = payload['conversationId'];
    if (typeof conversationId !== 'string') return;
    handlers.onGreetRequested({
      conversationId,
      endUserId: typeof payload['endUserId'] === 'string' ? payload['endUserId'] : undefined,
    });
    return;
  }

  if (type === 'curator_job.pending' && handlers.onCuratorJobPending) {
    const jobId = payload['jobId'];
    const jobUri = payload['jobUri'];
    const nextAttemptAt = payload['nextAttemptAt'];
    if (typeof jobId !== 'string' || typeof jobUri !== 'string') return;
    handlers.onCuratorJobPending({
      jobId,
      jobUri,
      dedupeKey: typeof payload['dedupeKey'] === 'string' ? payload['dedupeKey'] : null,
      nextAttemptAt:
        typeof nextAttemptAt === 'string' ? nextAttemptAt : new Date().toISOString(),
    });
    return;
  }

  if (type === 'agent.config.updated' && handlers.onAgentConfigChanged) {
    const configId = payload['configId'];
    if (typeof configId !== 'string') return;
    handlers.onAgentConfigChanged({ configId });
    return;
  }

  if (
    handlers.onKbDocumentChanged &&
    (type === 'kb.document.created' ||
      type === 'kb.document.updated' ||
      type === 'kb.document.deleted')
  ) {
    const spaceId = payload['spaceId'];
    const documentId = payload['documentId'];
    if (typeof spaceId !== 'string' || typeof documentId !== 'string') return;
    handlers.onKbDocumentChanged({
      type: type.split('.').pop() as 'created' | 'updated' | 'deleted',
      spaceId,
      documentId,
      slug: typeof payload['slug'] === 'string' ? payload['slug'] : null,
      version: typeof payload['version'] === 'number' ? payload['version'] : undefined,
    });
  }
}

function ownsEvent(event: EventRow, endUserId: string): boolean {
  const owner = event.payload?.['endUserId'];
  if (typeof owner === 'string') return owner === endUserId;
  return event.type.startsWith('conversation.');
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
