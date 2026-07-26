import type { schema, Db, Tx } from '@getmunin/db';

export interface ChannelAdapter {
  readonly kind: ChannelKind;

  readonly vendors: readonly string[];

  send(ctx: SendContext): Promise<SendResult>;

  readonly inbound: InboundMode | null;
}

export type ChannelKind = 'email' | 'chat' | 'sms' | 'voice';

export type InboundMode =
  | { mode: 'poll'; intervalMs: number; tick(channel: ChannelRow): Promise<PollTickResult> }
  | {
      mode: 'webhook';
      verify(req: IncomingWebhookRequest, channel: ChannelRow): Promise<InboundBatch>;
      toResponse?(batch: InboundBatch, channel: ChannelRow): WebhookResponse;
    }
  | { mode: 'push' };

export interface WebhookResponse {
  status: number;
  contentType?: string;
  body?: string;
}

export interface ChannelRow {
  id: string;
  orgId: string;
  type: string;
  vendor: string;
  name: string;
  config: Record<string, unknown>;
  active: boolean;
  defaultAgentMode: string;
}

export interface SendContext {
  delivery: typeof schema.convMessageDeliveries.$inferSelect;
  message: typeof schema.convMessages.$inferSelect;
  conversation: typeof schema.convConversations.$inferSelect;
  channel: ChannelRow;
  contact: typeof schema.convContacts.$inferSelect | null;
  attempt: number;
}

export interface SendResult {
  providerMessageId: string | null;
  rawResponse?: unknown;
}

export interface PollTickResult {
  messagesIngested: number;
  lastError?: string | null;
}

export interface IncomingWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  query: Record<string, string | string[] | undefined>;
}

export interface InboundBatch {
  messages: Array<{
    fromIdentity: { email?: string; phone?: string; name?: string };
    body: string;
    bodyHtml?: string | null;
    providerMessageId: string;
    inReplyTo?: string | null;
    receivedAt: Date;
    raw?: Record<string, unknown>;
  }>;
  responseOverride?: WebhookResponse;
}

export interface InboundCursorIo<TCursor extends Record<string, unknown>> {
  read(channelId: string): Promise<TCursor | null>;
  write(channelId: string, cursor: TCursor, lastError: string | null): Promise<void>;
}

export type DbOrTx = Db | Tx;

export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');

export class ChannelAdapterRegistry {
  private readonly byKey = new Map<string, ChannelAdapter>();
  private readonly adapters: ChannelAdapter[];

  constructor(adapters: ChannelAdapter[]) {
    this.adapters = [...adapters];
    for (const a of adapters) {
      for (const vendor of a.vendors) {
        const key = `${a.kind}:${vendor}`;
        if (this.byKey.has(key)) {
          throw new Error(`duplicate ChannelAdapter for '${key}'`);
        }
        this.byKey.set(key, a);
      }
    }
  }

  get(kind: string, vendor: string): ChannelAdapter | null {
    return this.byKey.get(`${kind}:${vendor}`) ?? null;
  }

  pollAdapters(): Array<ChannelAdapter & { inbound: Extract<InboundMode, { mode: 'poll' }> }> {
    return this.adapters.filter(
      (a): a is ChannelAdapter & { inbound: Extract<InboundMode, { mode: 'poll' }> } =>
        a.inbound?.mode === 'poll',
    );
  }
}
