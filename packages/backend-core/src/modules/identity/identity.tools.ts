import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { IdentityService } from './identity.service.ts';

const ResolveInput = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(1).max(40).optional(),
    externalId: z.string().min(1).max(255).optional(),
    visitorId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => Boolean(v.email || v.phone || v.externalId || v.visitorId), {
    message: 'at least one of email, phone, externalId, visitorId is required',
  });

const GetInput = z.object({ endUserId: z.string().min(1) });

@Injectable()
export class IdentityTools {
  constructor(@Inject(IdentityService) private readonly service: IdentityService) {}

  @McpTool({
    name: 'identity_resolve',
    title: 'Identity: Resolve',
    description:
      'Find the end-user identity that an email address, phone number, external id, or analytics visitor id belongs to. An end user is the durable per-person record created the first time someone reaches the org on any channel — inbound email, chat widget, or an analytics identify call — so it exists for people who have no CRM contact yet. Returns `endUserId` plus `matchedOn` naming which identifier matched, and `crmContactId` (null when no CRM contact has been created for this person). Returns `endUserId: null` when nothing matches; it never creates a record. Match order is external id, then email, then phone, then visitor id.',
    audiences: ['admin'],
    scopes: ['identity:read'],
    input: ResolveInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  resolve(args: z.infer<typeof ResolveInput>) {
    return this.service.resolve(args);
  }

  @McpTool({
    name: 'identity_get',
    title: 'Identity: Get',
    description:
      'Read one end user with a cross-channel summary: which channel types they have written on, how many conversations they have and when the last one was, their linked analytics visitor ids, their page-view and search event counts, and the ids of their CRM contact and conversation contact if those exist. Use it to see everything the org already knows about a person before answering them. Covers only data stored in Munin — orders and bookings live in the customer\'s own systems and are read separately by email.',
    audiences: ['admin'],
    scopes: ['identity:read'],
    input: GetInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  get(args: z.infer<typeof GetInput>) {
    return this.service.profile(args.endUserId);
  }
}
