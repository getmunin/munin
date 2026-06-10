import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import {
  ACTIVITY_TYPES,
  CONSENT_LAWFUL_BASES,
  CrmService,
  MERGE_CONFIDENCES,
  MERGE_STATUSES,
} from './crm.service.ts';

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
  mode: z
    .enum(['fill-null', 'overwrite'])
    .optional()
    .describe(
      "When 'fill-null', only applies patch keys whose existing value on the contact is null or empty — non-null fields are left untouched. Default 'overwrite' applies the patch as-is. Curator skills that backfill automated data should pass 'fill-null'; human-driven dashboard edits should use the default.",
    ),
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

const MergeConfidenceSchema = z.enum(MERGE_CONFIDENCES);
const MergeStatusSchema = z.enum(MERGE_STATUSES);

const ProposeMergeInput = z.object({
  contactAId: z.string().min(1).max(64),
  contactBId: z.string().min(1).max(64),
  confidence: MergeConfidenceSchema,
  evidence: z.record(z.string(), z.unknown()),
  recommendedKeeperId: z.string().min(1).max(64),
  recommendedPatch: z.record(z.string(), z.unknown()).optional(),
});

const ListMergeProposalsInput = z.object({
  status: MergeStatusSchema.optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const ApplyMergeProposalInput = z.object({
  id: z.string().min(1).max(64),
});

const DismissMergeProposalInput = z.object({
  id: z.string().min(1).max(64),
  reason: z.string().max(500).optional(),
});

const SegmentFilterSchema = z.object({
  tagsAny: z.array(z.string().min(1).max(64)).max(32).optional(),
  tagsAll: z.array(z.string().min(1).max(64)).max(32).optional(),
  companyId: z.string().min(1).max(64).optional(),
  searchQuery: z.string().min(1).max(200).optional(),
  contactedSince: z.string().datetime().optional(),
});

const CreateSegmentInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  filter: SegmentFilterSchema,
});

const UpdateSegmentInput = z.object({
  id: z.string().min(1).max(64),
  patch: z
    .object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(1000).nullable().optional(),
      filter: SegmentFilterSchema.optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: 'patch must contain at least one field' }),
});

const GetSegmentInput = z.object({ id: z.string().min(1).max(64) });

const DeleteSegmentInput = z.object({ id: z.string().min(1).max(64) });

const ListContactsInSegmentInput = z.object({
  id: z.string().min(1).max(64),
  limit: z.number().int().positive().max(500).optional(),
});

const SetContactConsentInput = z.object({
  contactId: z.string().min(1).max(64),
  lawfulBasis: z.enum(CONSENT_LAWFUL_BASES),
  source: z.string().min(1).max(120),
  evidence: z.record(z.string(), z.unknown()).optional(),
  givenAt: z.string().datetime().optional(),
});

@Injectable()
export class CrmAdminTools {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}

  // Contacts ────────────────────────────────────────────────────────────

  @McpTool({
    name: 'crm_list_contacts',
    title: 'CRM: List contacts',
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
    title: 'CRM: Read contact',
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
    title: 'CRM: Find contact by email or phone',
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
    title: 'CRM: Create contact',
    description: 'Create a new contact. Search with crm_find_contact first to avoid duplicates.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: CreateContactInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createContact(args: z.infer<typeof CreateContactInput>) {
    return this.crm.createContact(args);
  }

  @McpTool({
    name: 'crm_update_contact',
    title: 'CRM: Update contact',
    description:
      "Update fields on a contact. Only keys present in `patch` are touched; omitted keys are preserved. `customFields` is a partial patch — keys you send replace the corresponding keys; keys you omit are preserved (send `key: null` to clear a single custom field). Setting `doNotContact: true` also stamps `unsubscribedAt`; setting it false clears it. Pass `mode: 'fill-null'` from automated/curator contexts to refuse overwriting existing non-null values (only null/empty fields are filled). Default `mode: 'overwrite'` applies the patch as-is and is appropriate for human-driven edits.",
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: UpdateContactInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateContact(args: z.infer<typeof UpdateContactInput>) {
    return this.crm.updateContact(args);
  }

  @McpTool({
    name: 'crm_bulk_create_contacts',
    title: 'CRM: Bulk-create contacts',
    description:
      'Bulk-create contacts with dedupe + compliance checks: rows whose email or phone already match a do_not_contact contact are skipped, as are rows that would duplicate an existing contact.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: BulkCreateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  bulkCreateContacts(args: z.infer<typeof BulkCreateInput>) {
    return this.crm.bulkCreateContacts(args.contacts);
  }

  @McpTool({
    name: 'crm_search_contacts',
    title: 'CRM: Search contacts',
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
    title: 'CRM: List companies',
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
    title: 'CRM: Create company',
    description: 'Create a new company.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: CreateCompanyInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createCompany(args: z.infer<typeof CreateCompanyInput>) {
    return this.crm.createCompany(args);
  }

  // Pipelines + deals ───────────────────────────────────────────────────

  @McpTool({
    name: 'crm_list_pipelines',
    title: 'CRM: List sales pipelines',
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
    title: 'CRM: Create sales pipeline',
    description:
      'Create a new sales pipeline with at least one stage. Stages are inserted in array order; mark a stage `winLoss: "won"` or `"lost"` to record terminal outcomes.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: CreatePipelineInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createPipeline(args: z.infer<typeof CreatePipelineInput>) {
    return this.crm.createPipeline(args);
  }

  @McpTool({
    name: 'crm_list_deals',
    title: 'CRM: List deals',
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
    title: 'CRM: Create deal',
    description:
      'Create a new deal in a pipeline. If `stageId` is omitted, the deal lands in the pipeline\'s first stage by position.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: CreateDealInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createDeal(args: z.infer<typeof CreateDealInput>) {
    return this.crm.createDeal(args);
  }

  @McpTool({
    name: 'crm_change_stage',
    title: 'CRM: Change deal stage',
    description:
      'Move a deal to a new stage. If the destination stage is a won/lost terminal, `closedAt` is stamped automatically.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: ChangeStageInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  changeStage(args: z.infer<typeof ChangeStageInput>) {
    return this.crm.changeStage(args);
  }

  // Activities ──────────────────────────────────────────────────────────

  @McpTool({
    name: 'crm_log_activity',
    title: 'CRM: Log activity',
    description:
      'Record an activity (note / call / email / meeting / task) against a contact, company, or deal. If `contactId` is set, the contact\'s `lastContactedAt` is also bumped.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: LogActivityInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  logActivity(args: z.infer<typeof LogActivityInput>) {
    return this.crm.logActivity(args);
  }

  @McpTool({
    name: 'crm_list_activities',
    title: 'CRM: List activities',
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
    title: 'CRM: Set AI summary or next action',
    description:
      'Set the AI-generated summary and/or next-action for a contact, company, or deal. These live in dedicated columns so agents do not pollute the human-edited description.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: SetAiSummaryInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  setAiSummary(args: z.infer<typeof SetAiSummaryInput>) {
    return this.crm.setAiSummary(args);
  }

  // Merge proposals ─────────────────────────────────────────────────────

  @McpTool({
    name: 'crm_propose_merge_candidate',
    title: 'CRM: Propose a merge candidate',
    description:
      'File a structured proposal that two contacts are the same person. Pass `confidence` ("high" | "medium"), `evidence` (the matched signals — same email, same phone, similar name, etc.), `recommendedKeeperId` (which row to keep), and optionally `recommendedPatch` (fields to copy onto the keeper from the duplicate). Idempotent on the (contactA, contactB) pair while a pending proposal exists — calling again upserts the existing pending row. The CRM clean-contact-data curator runs this on a periodic cadence; see `skill://crm/clean-contact-data`.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: ProposeMergeInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  proposeMergeCandidate(args: z.infer<typeof ProposeMergeInput>) {
    return this.crm.proposeMerge(args);
  }

  @McpTool({
    name: 'crm_list_merge_proposals',
    title: 'CRM: List merge proposals',
    description:
      'List CRM merge proposals, defaulting to `status: "pending"` (the operator review queue). Returns each proposal with both contacts embedded as summaries — no extra `crm_get_contact` calls needed. Pass `status: "dismissed"` once per curator pass to skip pairs the operator has already rejected.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: ListMergeProposalsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listMergeProposals(args: z.infer<typeof ListMergeProposalsInput>) {
    return this.crm.listMergeProposals(args);
  }

  @McpTool({
    name: 'crm_apply_merge_proposal',
    title: 'CRM: Apply a merge proposal',
    description:
      "Atomically apply a pending merge proposal: copies `recommendedPatch` fields onto the keeper, archives the duplicate (adds `dedup-archived-YYYY-MM` tag, sets `customFields.mergedInto = <keeperId>`, sets `doNotContact: true`), and marks the proposal `applied`. Activities and deals stay on whichever contactId they were originally logged under — that's a documented v1 limitation. Throws if the proposal is not in `pending` status.",
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: ApplyMergeProposalInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  applyMergeProposal(args: z.infer<typeof ApplyMergeProposalInput>) {
    return this.crm.applyMergeProposal(args);
  }

  @McpTool({
    name: 'crm_dismiss_merge_proposal',
    title: 'CRM: Dismiss a merge proposal',
    description:
      'Mark a pending merge proposal as dismissed (the operator decided these are not the same person). The next CRM hygiene curator pass queries dismissed proposals and skips refiling the same pair. Optional `reason` is stored for audit. Throws if the proposal is not in `pending` status.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: DismissMergeProposalInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  dismissMergeProposal(args: z.infer<typeof DismissMergeProposalInput>) {
    return this.crm.dismissMergeProposal(args);
  }

  // Segments ────────────────────────────────────────────────────────────

  @McpTool({
    name: 'crm_list_segments',
    title: 'CRM: List segments',
    description:
      'List saved contact segments. A segment is a named CRM filter — used as the audience for outreach campaigns and other targeting workflows. Returns each segment with its filter definition.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: z.object({}),
    readOnlyHint: true,
    destructiveHint: false,
  })
  listSegments() {
    return this.crm.listSegments();
  }

  @McpTool({
    name: 'crm_get_segment',
    title: 'CRM: Read segment',
    description: 'Read one segment, including its filter definition.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: GetSegmentInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getSegment(args: z.infer<typeof GetSegmentInput>) {
    return this.crm.getSegment(args.id);
  }

  @McpTool({
    name: 'crm_create_segment',
    title: 'CRM: Create segment',
    description:
      'Create a saved contact segment. `filter` supports tagsAny (any-of match), tagsAll (all-of match), companyId, searchQuery (substring over name/email/title), and contactedSince (ISO-8601 — narrows to contacts NOT contacted since that timestamp). Combine fields and they AND together.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: CreateSegmentInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createSegment(args: z.infer<typeof CreateSegmentInput>) {
    return this.crm.createSegment(args);
  }

  @McpTool({
    name: 'crm_update_segment',
    title: 'CRM: Update segment',
    description: 'Patch a segment: rename, edit description, or replace the filter.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: UpdateSegmentInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateSegment(args: z.infer<typeof UpdateSegmentInput>) {
    return this.crm.updateSegment(args);
  }

  @McpTool({
    name: 'crm_delete_segment',
    title: 'CRM: Delete segment',
    description: 'Delete a segment. Outreach campaigns referencing it will fail until reassigned.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: DeleteSegmentInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  deleteSegment(args: z.infer<typeof DeleteSegmentInput>) {
    return this.crm.deleteSegment(args.id);
  }

  @McpTool({
    name: 'crm_list_contacts_in_segment',
    title: 'CRM: List contacts in segment',
    description:
      'Resolve a segment to its current contacts. ALWAYS excludes suppressed contacts (do_not_contact OR unsubscribed) AND contacts without a recorded lawful basis (consent_lawful_basis IS NULL). Use this — not crm_list_contacts — to materialize an outreach audience: the suppression and consent floors are non-overridable here.',
    audiences: ['admin'],
    scopes: ['crm:read'],
    input: ListContactsInSegmentInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listContactsInSegment(args: z.infer<typeof ListContactsInSegmentInput>) {
    return this.crm.listContactsInSegment(args);
  }

  // Consent ─────────────────────────────────────────────────────────────

  @McpTool({
    name: 'crm_set_contact_consent',
    title: 'CRM: Set contact consent',
    description:
      'Record the lawful basis and source for contacting this person. Required before they can appear in any outreach segment. `lawfulBasis` is one of `consent`, `legitimate_interest`, or `contract`. `source` is a short label (e.g. "imported-2026-q2", "web-form-trial-signup", "event-attendee-summit-2025"). Logs a CRM activity for audit.',
    audiences: ['admin'],
    scopes: ['crm:write'],
    input: SetContactConsentInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  setContactConsent(args: z.infer<typeof SetContactConsentInput>) {
    return this.crm.setContactConsent(args);
  }
}
