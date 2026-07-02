import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { WebhooksService } from './webhooks.service.ts';

const WebhookUrlSchema = z
  .string()
  .url()
  .refine((u) => {
    try {
      return new URL(u).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'webhook URL must use https://');

const EmptyInput = z.object({});

const CreateInput = z.object({
  url: WebhookUrlSchema,
  events: z.array(z.string().min(1).max(64)).max(64).optional(),
  active: z.boolean().optional(),
});

const UpdateInput = z.object({
  id: z.string(),
  patch: z.object({
    url: WebhookUrlSchema.optional(),
    events: z.array(z.string().min(1).max(64)).max(64).optional(),
    active: z.boolean().optional(),
  }),
});

const IdInput = z.object({ id: z.string() });

const ListDeliveriesInput = z.object({
  webhookId: z.string(),
  limit: z.number().int().positive().max(200).optional(),
  status: z.enum(['pending', 'delivered', 'failed']).optional(),
});

@Injectable()
export class WebhookAdminTools {
  constructor(@Inject(WebhooksService) private readonly webhooks: WebhooksService) {}

  @McpTool({
    name: 'webhooks_list',
    title: 'Webhooks: List',
    description:
      'List all webhook subscriptions for your org. Secrets are not returned — they are only shown once at creation. Use webhooks_rotate_secret if you lost it.',
    audiences: ['admin'],
    scopes: ['webhooks:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  list() {
    return this.webhooks.list();
  }

  @McpTool({
    name: 'webhooks_create',
    title: 'Webhooks: Create',
    description:
      'Create a webhook subscription. `url` must be https://. `events` is an array of event type strings (e.g. ["cms.entry.published"]); omit or pass an empty array to subscribe to all events. The response includes a one-time `secret` of the form `whsec_…` — store it now; it cannot be retrieved later. Deliveries are signed with `x-munin-signature: sha256=<HMAC-SHA256("<x-munin-timestamp>." + body, secret)>` and include `x-munin-timestamp` (unix seconds), `x-munin-event`, and `x-munin-delivery-id` headers. To verify, reject requests whose `x-munin-timestamp` is outside your freshness window, then recompute the HMAC over `timestamp + "." + rawBody`. Retries: up to 5 attempts with exponential backoff (30s → 8m). Use webhooks_list_event_types to discover known event names.',
    audiences: ['admin'],
    scopes: ['webhooks:write'],
    input: CreateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  create(args: z.infer<typeof CreateInput>) {
    return this.webhooks.create(args);
  }

  @McpTool({
    name: 'webhooks_update',
    title: 'Webhooks: Update',
    description:
      'Patch a webhook subscription. Pass only the fields you want to change. Replacing `events` overwrites the full array — read first if you mean to append.',
    audiences: ['admin'],
    scopes: ['webhooks:write'],
    input: UpdateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  update(args: z.infer<typeof UpdateInput>) {
    return this.webhooks.update(args.id, args.patch);
  }

  @McpTool({
    name: 'webhooks_delete',
    title: 'Webhooks: Delete',
    description:
      'Delete a webhook. Pending deliveries are cascade-deleted; in-flight HTTP attempts finish their current run.',
    audiences: ['admin'],
    scopes: ['webhooks:write'],
    input: IdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  delete(args: z.infer<typeof IdInput>) {
    return this.webhooks.delete(args.id);
  }

  @McpTool({
    name: 'webhooks_rotate_secret',
    title: 'Webhooks: Rotate signing secret',
    description:
      'Generate a new `whsec_…` secret for a webhook. The previous secret stops signing deliveries immediately — update your receiver before rotating. The new secret is returned once in the response.',
    audiences: ['admin'],
    scopes: ['webhooks:write'],
    input: IdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  rotateSecret(args: z.infer<typeof IdInput>) {
    return this.webhooks.rotateSecret(args.id);
  }

  @McpTool({
    name: 'webhooks_list_deliveries',
    title: 'Webhooks: List deliveries',
    description:
      'List delivery attempts for one webhook, newest first. Each row has attempt count, statusCode, durationMs, error, deliveredAt, nextAttemptAt, and a rolled-up `status` (pending / delivered / failed). Filter with `status` and cap with `limit` (default 50, max 200).',
    audiences: ['admin'],
    scopes: ['webhooks:read'],
    input: ListDeliveriesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listDeliveries(args: z.infer<typeof ListDeliveriesInput>) {
    return this.webhooks.listDeliveries(args);
  }

  @McpTool({
    name: 'webhooks_list_event_types',
    title: 'Webhooks: List event types',
    description:
      'List the known event type strings emitted across modules (cms, crm, kb, conv, outreach, system). Use the returned strings as input to webhooks_create. The subscription accepts arbitrary strings, so future event types work without a tool update — but this is the canonical catalog today.',
    audiences: ['admin'],
    scopes: ['webhooks:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listEventTypes() {
    return this.webhooks.listEventTypes();
  }
}
