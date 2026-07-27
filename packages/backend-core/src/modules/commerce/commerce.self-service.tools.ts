import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { CommerceService } from './commerce.service.ts';

const GetMyOrdersInput = z.object({
  connectionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

const GetMyOrderInput = z.object({
  connectionId: z.string().min(1).optional(),
  orderRef: z.string().min(1).max(64).optional(),
  orderNumber: z.string().min(1).max(64).optional(),
});

@Injectable()
export class CommerceSelfServiceTools {
  constructor(@Inject(CommerceService) private readonly commerce: CommerceService) {}

  @McpTool({
    name: 'commerce_get_my_orders',
    title: 'Commerce: My recent orders',
    description:
      'List the calling end-user’s recent store orders (newest first). Scoped server-side to the email on the end-user’s own record — other customers’ orders are never visible. `connectionId` is only needed when the org has multiple active store connections.',
    audiences: ['self_service'],
    scopes: ['commerce:read'],
    input: GetMyOrdersInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getMyOrders(args: z.infer<typeof GetMyOrdersInput>) {
    return this.commerce.getMyOrders(args);
  }

  @McpTool({
    name: 'commerce_get_my_order',
    title: 'Commerce: One of my orders, with tracking',
    description:
      'Fetch one of the calling end-user’s orders, including line items and shipment tracking. Identify it by `orderRef` (from an order listing) or the human-facing `orderNumber` on the order confirmation. Returns not-found unless the order belongs to the calling end-user.',
    audiences: ['self_service'],
    scopes: ['commerce:read'],
    input: GetMyOrderInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getMyOrder(args: z.infer<typeof GetMyOrderInput>) {
    return this.commerce.getMyOrder(args);
  }
}
