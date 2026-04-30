import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { ACTIVITY_TYPES, CrmService } from './crm.service.js';

const TagsSchema = z.array(z.string().min(1).max(64)).max(32);
const ActivityType = z.enum(ACTIVITY_TYPES);

const ListContactsInput = z.object({
  companyId: z.string().optional(),
  tag: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const GetContactInput = z.object({ id: z.string() });

const FindContactInput = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().optional(),
  })
  .refine((v) => v.email || v.phone, {
    message: 'at least one of email or phone is required',
  });

const ContactPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  title: z.string().max(120).optional(),
  address: z.string().max(500).optional(),
  companyId: z.string().nullable().optional(),
  ownerUserId: z.string().nullable().optional(),
  tags: TagsSchema.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  doNotContact: z.boolean().optional(),
});

const CreateContactInput = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  title: z.string().max(120).optional(),
  address: z.string().max(500).optional(),
  companyId: z.string().optional(),
  endUserId: z.string().optional(),
  tags: TagsSchema.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const UpdateContactInput = z.object({
  id: z.string(),
  patch: ContactPatchSchema,
});

const BulkCreateInput = z.object({
  contacts: z.array(CreateContactInput).max(500),
});

const SearchContactsInput = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().positive().max(100).optional(),
});

const ListCompaniesInput = z.object({
  limit: z.number().int().positive().max(200).optional(),
});

const CreateCompanyInput = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(200).optional(),
  tags: TagsSchema.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const CreatePipelineInput = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64),
  stages: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        winLoss: z.enum(['open', 'won', 'lost']).optional(),
      }),
    )
    .min(1)
    .max(20),
});

const ListDealsInput = z.object({
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const CreateDealInput = z.object({
  name: z.string().min(1).max(200),
  pipelineId: z.string(),
  stageId: z.string().optional(),
  amountCents: z.number().int().nonnegative().optional(),
  currency: z.string().min(3).max(8).optional(),
  primaryContactId: z.string().optional(),
  companyId: z.string().optional(),
  expectedCloseAt: z.string().datetime().optional(),
});

const ChangeStageInput = z.object({
  dealId: z.string(),
  stageId: z.string(),
});

const LogActivityInput = z.object({
  type: ActivityType,
  subject: z.string().max(300).optional(),
  body: z.string().max(50_000).optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  dealId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ListActivitiesInput = z.object({
  contactId: z.string().optional(),
  dealId: z.string().optional(),
  companyId: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const SetAiSummaryInput = z.object({
  entityType: z.enum(['contact', 'company', 'deal']),
  id: z.string(),
  summary: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
});

const EmptyInput = z.object({});

@Injectable()
export class CrmAdminTools {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}

  // Contacts ────────────────────────────────────────────────────────────

  @McpTool({
    name: 'crm_list_contacts',
    title: 'List contacts',
    description: 'List contacts in your org, newest-updated first. Filter by company or tag.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: ListContactsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listContacts(args: z.infer<typeof ListContactsInput>) {
    return this.crm.listContacts(args);
  }

  @McpTool({
    name: 'crm_get_contact',
    title: 'Read contact',
    description: 'Read one contact, including AI fields, tags, custom fields, and compliance flags.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: GetContactInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getContact(args: z.infer<typeof GetContactInput>) {
    return this.crm.getContact(args.id);
  }

  @McpTool({
    name: 'crm_find_contact',
    title: 'Find contact by email or phone',
    description:
      'Find an existing contact by email and/or phone before creating a new one. Returns null if no match.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: FindContactInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  findContact(args: z.infer<typeof FindContactInput>) {
    return this.crm.findContact(args);
  }

  @McpTool({
    name: 'crm_create_contact',
    title: 'Create contact',
    description: 'Create a new contact. Search with crm_find_contact first to avoid duplicates.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: CreateContactInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  createContact(args: z.infer<typeof CreateContactInput>) {
    return this.crm.createContact(args);
  }

  @McpTool({
    name: 'crm_update_contact',
    title: 'Update contact',
    description:
      'Update fields on a contact. Setting `doNotContact: true` also stamps `unsubscribedAt`; setting it false clears it.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: UpdateContactInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  updateContact(args: z.infer<typeof UpdateContactInput>) {
    return this.crm.updateContact(args);
  }

  @McpTool({
    name: 'crm_bulk_create_contacts',
    title: 'Bulk-create contacts',
    description:
      'Bulk-create contacts with dedupe + compliance checks: rows whose email or phone already match a do_not_contact contact are skipped, as are rows that would duplicate an existing contact.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: BulkCreateInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  bulkCreateContacts(args: z.infer<typeof BulkCreateInput>) {
    return this.crm.bulkCreateContacts(args.contacts);
  }

  @McpTool({
    name: 'crm_search_contacts',
    title: 'Search contacts',
    description:
      'Substring search across name, email, phone, and title. Returns contacts ordered newest-updated first.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: SearchContactsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  searchContacts(args: z.infer<typeof SearchContactsInput>) {
    return this.crm.searchContacts(args);
  }

  // Companies ───────────────────────────────────────────────────────────

  @McpTool({
    name: 'crm_list_companies',
    title: 'List companies',
    description: 'List companies in your org.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: ListCompaniesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listCompanies(args: z.infer<typeof ListCompaniesInput>) {
    return this.crm.listCompanies(args);
  }

  @McpTool({
    name: 'crm_create_company',
    title: 'Create company',
    description: 'Create a new company.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: CreateCompanyInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  createCompany(args: z.infer<typeof CreateCompanyInput>) {
    return this.crm.createCompany(args);
  }

  // Pipelines + deals ───────────────────────────────────────────────────

  @McpTool({
    name: 'crm_list_pipelines',
    title: 'List sales pipelines',
    description: 'List sales pipelines for your org with their stages in position order.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listPipelines() {
    return this.crm.listPipelines();
  }

  @McpTool({
    name: 'crm_create_pipeline',
    title: 'Create sales pipeline',
    description:
      'Create a new sales pipeline with at least one stage. Stages are inserted in array order; mark a stage `winLoss: "won"` or `"lost"` to record terminal outcomes.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: CreatePipelineInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  createPipeline(args: z.infer<typeof CreatePipelineInput>) {
    return this.crm.createPipeline(args);
  }

  @McpTool({
    name: 'crm_list_deals',
    title: 'List deals',
    description: 'List deals, optionally filtered by pipeline or stage.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: ListDealsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listDeals(args: z.infer<typeof ListDealsInput>) {
    return this.crm.listDeals(args);
  }

  @McpTool({
    name: 'crm_create_deal',
    title: 'Create deal',
    description:
      'Create a new deal in a pipeline. If `stageId` is omitted, the deal lands in the pipeline\'s first stage by position.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: CreateDealInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  createDeal(args: z.infer<typeof CreateDealInput>) {
    return this.crm.createDeal(args);
  }

  @McpTool({
    name: 'crm_change_stage',
    title: 'Change deal stage',
    description:
      'Move a deal to a new stage. If the destination stage is a won/lost terminal, `closedAt` is stamped automatically.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: ChangeStageInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  changeStage(args: z.infer<typeof ChangeStageInput>) {
    return this.crm.changeStage(args);
  }

  // Activities ──────────────────────────────────────────────────────────

  @McpTool({
    name: 'crm_log_activity',
    title: 'Log CRM activity',
    description:
      'Record an activity (note / call / email / meeting / task) against a contact, company, or deal. If `contactId` is set, the contact\'s `lastContactedAt` is also bumped.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: LogActivityInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  logActivity(args: z.infer<typeof LogActivityInput>) {
    return this.crm.logActivity(args);
  }

  @McpTool({
    name: 'crm_list_activities',
    title: 'List CRM activities',
    description: 'List CRM activities filtered by contact, deal, or company.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: ListActivitiesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listActivities(args: z.infer<typeof ListActivitiesInput>) {
    return this.crm.listActivities(args);
  }

  // AI fields ───────────────────────────────────────────────────────────

  @McpTool({
    name: 'crm_set_ai_summary',
    title: 'Set AI summary or next action',
    description:
      'Set the AI-generated summary and/or next-action for a contact, company, or deal. These live in dedicated columns so agents do not pollute the human-edited description.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: SetAiSummaryInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  setAiSummary(args: z.infer<typeof SetAiSummaryInput>) {
    return this.crm.setAiSummary(args);
  }
}
