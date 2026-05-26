import type { schema, Db, Tx } from '@getmunin/db';

/**
 * The per-channel-type runtime contract. One adapter per `conv_channels.type`
 * value (`'email'`, `'chat'`, etc.). The generic poll/outbound workers and
 * the chat-widget controller dispatch to the adapter that matches the
 * channel's type.
 *
 * Three inbound modes:
 *   - 'poll'    — runtime calls `tick()` on a timer (e.g. email IMAP).
 *   - 'webhook' — runtime exposes `POST /v1/conversations/channels/:id/webhook`; provider
 *                 → us. Adapter verifies the signature.
 *   - 'push'    — adapter exposes its own controller; agent → us via bearer
 *                 token (e.g. chat widget). Runtime doesn't drive it.
 *   - null      — channel is outbound-only.
 *
 * Outbound is uniform: `send()` is called by `OutboundDeliveryWorker` after
 * loading delivery + message + conversation + channel + contact context.
 * Adapters that don't deliver outbound (push-mode-only) return a no-op
 * SendResult.
 */
export interface ChannelAdapter {
  /** Matches `conv_channels.type`. */
  readonly kind: ChannelKind;

  /** Matches `conv_channels.vendor`. One adapter may declare multiple vendors when it serves them internally (e.g. email handles 'smtp' + 'mailer'). */
  readonly vendors: readonly string[];

  /** Send one outbound message. Throws on transport failure. */
  send(ctx: SendContext): Promise<SendResult>;

  /** Inbound mode + per-mode hooks. `null` = outbound-only channel. */
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
}

export interface SendContext {
  delivery: typeof schema.convMessageDeliveries.$inferSelect;
  message: typeof schema.convMessages.$inferSelect;
  conversation: typeof schema.convConversations.$inferSelect;
  channel: ChannelRow;
  contact: typeof schema.convContacts.$inferSelect | null;
  /** Per-attempt counter (0-indexed). The worker passes the current value. */
  attempt: number;
}

export interface SendResult {
  /** RFC-822 Message-ID, Twilio MessageSid, etc. — stamped on convMessageDeliveries. */
  providerMessageId: string | null;
  /** Optional opaque payload the worker stores nowhere; useful for tests / logs. */
  rawResponse?: unknown;
}

export interface PollTickResult {
  messagesIngested: number;
  /** Optional error text recorded on convInboundState.lastError. */
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

/**
 * Helper for adapters: read and write the per-channel inbound cursor.
 * `convInboundState` is keyed by channel_id; `cursor` is an open jsonb shape.
 */
export interface InboundCursorIo<TCursor extends Record<string, unknown>> {
  read(channelId: string): Promise<TCursor | null>;
  write(channelId: string, cursor: TCursor, lastError: string | null): Promise<void>;
}

/** Re-exported so adapter implementations don't need to import @getmunin/db. */
export type DbOrTx = Db | Tx;

/** Multi-injection token. Adapters provide themselves via `{ provide: CHANNEL_ADAPTERS, useExisting: <AdapterClass>, multi: true }`. */
export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');

/**
 * Registry: looks up an adapter by `(channel.type, channel.vendor)`. The
 * generic workers tolerate misses by marking the delivery 'dead' instead —
 * they don't throw on lookup failure.
 */
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
