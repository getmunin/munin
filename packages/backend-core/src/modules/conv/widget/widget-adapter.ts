import { Injectable } from '@nestjs/common';
import type { ChannelAdapter, InboundMode, SendContext, SendResult } from '../channels/adapter.js';

/**
 * Chat-widget adapter — push mode. Inbound is driven by the external agent
 * via the public REST endpoint (`POST /api/v1/widget/messages`); the
 * runtime doesn't poll or expose a webhook for this kind.
 *
 * Outbound is a no-op for v1: Munin replies render in the customer's own
 * widget code via `conversation.message.sent` webhook subscriptions. If
 * something accidentally enqueues a `conv_message_deliveries` row for a
 * chat channel, `send` returns a successful no-op so the row settles into
 * 'sent' rather than churning forever.
 */
@Injectable()
export class WidgetAdapter implements ChannelAdapter {
  readonly kind = 'chat' as const;
  readonly vendors = ['munin'] as const;

  readonly inbound: InboundMode = { mode: 'push' };

  send(_ctx: SendContext): Promise<SendResult> {
    return Promise.resolve({ providerMessageId: null });
  }
}
