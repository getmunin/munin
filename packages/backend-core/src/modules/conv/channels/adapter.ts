import type { schema, Db, Tx } from '@getmunin/db';

/**
 * The per-channel-type runtime contract. One adapter per `conv_channels.type`
 * value (`'email'`, `'chat'`, etc.). The generic poll/outbound workers and
 * the chat-widget controller dispatch to the adapter that matches the
 * channel's type.
 *
 * Three inbound modes:
 *   - 'poll'    — runtime calls `tick()` on a timer (e.g. email IMAP).
 *   - 'webhook' — runtime exposes `POST /api/v1/conversations/channels/:id/webhook`; provider
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

  /** Send one outbound message. Throws on transport failure. */
  send(ctx: SendContext): Promise<SendResult>;

  /** Inbound mode + per-mode hooks. `null` = outbound-only channel. */
  readonly inbound: InboundMode | null;
}

export type ChannelKind = 'email' | 'chat' | 'sms' | 'voice';

export type InboundMode =
  | { mode: 'poll'; intervalMs: number; tick(channel: ChannelRow): Promise<PollTickResult> }
  | { mode: 'webhook'; verify(req: IncomingWebhookRequest, channel: ChannelRow): Promise<InboundBatch> }
  | { mode: 'push' };

export interface ChannelRow {
  id: string;
  orgId: string;
  type: string;
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
 * Registry: looks up an adapter by `channel.type`. Throws if none registered
 * for the kind. The generic workers tolerate misses by marking the delivery
 * 'dead' instead — they don't call this function directly.
 */
export class ChannelAdapterRegistry {
  private readonly byKind = new Map<string, ChannelAdapter>();

  constructor(adapters: ChannelAdapter[]) {
    for (const a of adapters) {
      if (this.byKind.has(a.kind)) {
        throw new Error(`duplicate ChannelAdapter for kind '${a.kind}'`);
      }
      this.byKind.set(a.kind, a);
    }
  }

  get(kind: string): ChannelAdapter | null {
    return this.byKind.get(kind) ?? null;
  }

  pollAdapters(): Array<ChannelAdapter & { inbound: Extract<InboundMode, { mode: 'poll' }> }> {
    return [...this.byKind.values()].filter(
      (a): a is ChannelAdapter & { inbound: Extract<InboundMode, { mode: 'poll' }> } =>
        a.inbound?.mode === 'poll',
    );
  }
}
