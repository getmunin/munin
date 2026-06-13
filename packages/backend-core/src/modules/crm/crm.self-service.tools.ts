import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { ACTIVITY_TYPES, CrmInvalidError, CrmService } from './crm.service.ts';
import { getCurrentContext } from '@getmunin/core';

const EmptyInput = z.object({});

const UpdateMyContactInput = z.object({
  /** Self-service callers can only edit basic personal fields, not tags / owner / custom-fields / AI fields. */
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
});

const LogActivitySelfInput = z.object({
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().max(300).optional(),
  body: z.string().max(50_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

@Injectable()
export class CrmSelfServiceTools {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}

  @McpTool({
    name: 'crm_get_my_contact',
    title: 'CRM: Read my contact',
    description:
      'Read the CRM contact linked to the calling end-user. RLS restricts visibility to that single row.',
    audiences: ['self_service'],
    scopes: ['crm:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getMyContact() {
    return this.crm.getMyContact();
  }

  @McpTool({
    name: 'crm_update_my_contact',
    title: 'CRM: Update my contact',
    description:
      'Update the calling end-user\'s own contact record. Only basic personal fields (name, phone, address) are editable from this surface — tags, ownership, custom fields, and AI fields are admin-only.',
    audiences: ['self_service'],
    scopes: ['crm:write'],
    input: UpdateMyContactInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async updateMyContact(args: z.infer<typeof UpdateMyContactInput>) {
    const own = await this.crm.getMyContact();
    return this.crm.updateContact({ id: own.id, patch: args });
  }

  @McpTool({
    name: 'crm_log_my_activity',
    title: 'CRM: Log activity as end-user',
    description:
      'Record an activity attributed to the calling end-user agent (e.g. a voice agent logging "spoke with customer for 4m, follow-up needed"). Auto-scoped to the end-user\'s own CRM contact when one exists.',
    audiences: ['self_service'],
    scopes: ['crm:write'],
    input: LogActivitySelfInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async logActivitySelf(args: z.infer<typeof LogActivitySelfInput>) {
    const ctx = getCurrentContext();
    if (!ctx.actor!.endUserId) {
      throw new CrmInvalidError('end-user identity required');
    }
    const own = await this.crm.getMyContact().catch(() => null);
    return this.crm.logActivity({
      type: args.type,
      subject: args.subject,
      body: args.body,
      contactId: own?.id,
      metadata: args.metadata,
    });
  }
}
