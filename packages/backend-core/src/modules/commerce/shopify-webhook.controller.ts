import { HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PublicController } from '../../common/auth/auth.guard.ts';
import { ShopifyOrderEventsService } from './shopify-order-events.service.ts';

@PublicController('v1/commerce/shopify/webhooks')
export class ShopifyWebhookController {
  constructor(private readonly orderEvents: ShopifyOrderEventsService) {}

  @Post(':connectionId')
  @HttpCode(200)
  receive(@Param('connectionId') connectionId: string, @Req() req: Request): Promise<{ status: string }> {
    const header = (name: string): string | undefined => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    return this.orderEvents.receive({
      connectionId,
      rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
      hmac: header('x-shopify-hmac-sha256'),
      topic: header('x-shopify-topic'),
      webhookId: header('x-shopify-webhook-id') ?? header('x-shopify-event-id'),
    });
  }
}
