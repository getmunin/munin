import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import postgres from 'postgres';
import { parseEnvDisableFlag } from '@getmunin/core';

export interface EventRow {
  id: string;
  org_id: string;
  type: string;
  actor_id: string | null;
  correlation_id: string | null;
  hop_count: number;
  payload: Record<string, unknown>;
  created_at: string;
}

export type EventHandler = (row: EventRow) => void;

export interface TypingNotification {
  orgId: string;
  conversationId: string;
  isTyping: boolean;
  authorType: 'visitor' | 'operator';
  originInstanceId?: string;
}

export type TypingHandler = (notification: TypingNotification) => void;

export const AGENT_TYPING_CHANNEL = 'agent_typing';

@Injectable()
export class DbListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbListenerService.name);
  private client: ReturnType<typeof postgres> | null = null;
  private readonly handlers = new Set<EventHandler>();
  private readonly typingHandlers = new Set<TypingHandler>();

  async onModuleInit(): Promise<void> {
    if (parseEnvDisableFlag('MUNIN_REALTIME_DISABLED')) {
      this.logger.log('realtime listener disabled via MUNIN_REALTIME_DISABLED');
      return;
    }
    const url = process.env.DATABASE_URL;
    if (!url) {
      this.logger.warn('DATABASE_URL unset; realtime listener inactive');
      return;
    }
    this.client = postgres(url, {
      max: 1,
      connection: { options: '-c app.bypass_rls=on' },
    });
    await this.client.listen('munin_events', (raw) => this.dispatch(raw));
    await this.client.listen(AGENT_TYPING_CHANNEL, (raw) => this.dispatchTyping(raw));
    this.logger.log(`listening on munin_events and ${AGENT_TYPING_CHANNEL}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    await this.client.end({ timeout: 5 }).catch(() => undefined);
    this.client = null;
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribeTyping(handler: TypingHandler): () => void {
    this.typingHandlers.add(handler);
    return () => this.typingHandlers.delete(handler);
  }

  private dispatch(raw: string): void {
    let row: EventRow;
    try {
      row = JSON.parse(raw) as EventRow;
    } catch (err) {
      this.logger.warn(`malformed NOTIFY payload: ${describe(err)}`);
      return;
    }
    for (const handler of this.handlers) {
      try {
        handler(row);
      } catch (err) {
        this.logger.warn(`handler error: ${describe(err)}`);
      }
    }
  }

  private dispatchTyping(raw: string): void {
    let notification: TypingNotification;
    try {
      const parsed = JSON.parse(raw) as Partial<TypingNotification>;
      if (
        typeof parsed.orgId !== 'string' ||
        typeof parsed.conversationId !== 'string' ||
        typeof parsed.isTyping !== 'boolean' ||
        (parsed.authorType !== 'visitor' && parsed.authorType !== 'operator')
      ) {
        this.logger.warn('malformed agent_typing payload: missing fields');
        return;
      }
      notification = {
        orgId: parsed.orgId,
        conversationId: parsed.conversationId,
        isTyping: parsed.isTyping,
        authorType: parsed.authorType,
        originInstanceId:
          typeof parsed.originInstanceId === 'string' ? parsed.originInstanceId : undefined,
      };
    } catch (err) {
      this.logger.warn(`malformed agent_typing payload: ${describe(err)}`);
      return;
    }
    for (const handler of this.typingHandlers) {
      try {
        handler(notification);
      } catch (err) {
        this.logger.warn(`typing handler error: ${describe(err)}`);
      }
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
