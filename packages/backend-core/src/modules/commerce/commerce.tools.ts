import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { CommerceService } from './commerce.service.ts';

const LookupOrdersInput = z.object({
  email: z.string().email(),
  connectionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const LookupOrderInput = z.object({
  email: z.string().email(),
  connectionId: z.string().min(1).optional(),
  orderRef: z.string().min(1).max(64).optional(),
  orderNumber: z.string().min(1).max(64).optional(),
});

@Injectable()
export class CommerceAdminTools {
  constructor(@Inject(CommerceService) private readonly commerce: CommerceService) {}

  @McpTool({
    name: 'commerce_lookup_orders',
    title: 'Commerce: Look up a customer’s orders',
    description:
      'List a customer’s recent store orders by email (newest first), e.g. while handling their support conversation. `connectionId` is only needed when multiple commerce connections are active.',
    audiences: ['admin'],
    scopes: ['commerce:read'],
    input: LookupOrdersInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  lookupOrders(args: z.infer<typeof LookupOrdersInput>) {
    return this.commerce.lookupOrders(args);
  }

  @McpTool({
    name: 'commerce_lookup_order',
    title: 'Commerce: Look up one order with tracking',
    description:
      'Fetch one order for a customer email, including line items and shipment tracking. Identify the order by `orderRef` (from an order listing) or the human-facing `orderNumber` the customer knows. Returns not-found unless the order belongs to that email.',
    audiences: ['admin'],
    scopes: ['commerce:read'],
    input: LookupOrderInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  lookupOrder(args: z.infer<typeof LookupOrderInput>) {
    return this.commerce.lookupOrder(args);
  }
}
