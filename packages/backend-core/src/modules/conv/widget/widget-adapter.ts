import { Injectable } from '@nestjs/common';
import type { ChannelAdapter, InboundMode, SendContext, SendResult } from '../channels/adapter.ts';

@Injectable()
export class WidgetAdapter implements ChannelAdapter {
  readonly kind = 'chat' as const;
  readonly vendors = ['munin'] as const;

  readonly inbound: InboundMode = { mode: 'push' };

  send(_ctx: SendContext): Promise<SendResult> {
    return Promise.resolve({ providerMessageId: null });
  }
}
