import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { OutreachService, PROPOSAL_KINDS, PROPOSAL_STATUSES } from './outreach.service.ts';

const CadenceRulesSchema = z.object({
  maxPerWeekPerContact: z.number().int().positive().max(7).optional(),
  quietHoursStart: z.string().regex(/^[0-2]\d:[0-5]\d$/).optional(),
  quietHoursEnd: z.string().regex(/^[0-2]\d:[0-5]\d$/).optional(),
  blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(50).optional(),
});

const CreateCampaignInput = z.object({
  name: z.string().min(1).max(120),
  brief: z.string().min(1).max(5000),
  segmentId: z.string().min(1).max(64),
  channelId: z.string().min(1).max(64),
  cadenceRules: CadenceRulesSchema.optional(),
  ctaUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
  unsubscribeRequired: z.boolean().optional(),
});

const UpdateCampaignInput = z.object({
  id: z.string().min(1).max(64),
  patch: z
    .object({
      name: z.string().min(1).max(120).optional(),
      brief: z.string().min(1).max(5000).optional(),
      segmentId: z.string().min(1).max(64).optional(),
      channelId: z.string().min(1).max(64).optional(),
      cadenceRules: CadenceRulesSchema.optional(),
      ctaUrl: z.string().url().nullable().optional(),
      enabled: z.boolean().optional(),
      unsubscribeRequired: z.boolean().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: 'patch must contain at least one field' }),
});

const GetCampaignInput = z.object({ id: z.string().min(1).max(64) });

const ListProposalsInput = z.object({
  status: z.enum(PROPOSAL_STATUSES).optional(),
  campaignId: z.string().min(1).max(64).optional(),
  kind: z.enum(PROPOSAL_KINDS).optional(),
  contactId: z.string().min(1).max(64).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const ProposeInitialInput = z.object({
  campaignId: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
  draftSubject: z
    .string()
    .max(300)
    .optional()
    .describe('Required for email campaigns; omit for voice campaigns where the call has no subject.'),
  draftBody: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      'For email campaigns: the email body. For voice campaigns: the opening line / talking-points the AI agent should use when the call connects.',
    ),
  evidence: z.record(z.string(), z.unknown()).optional(),
  proposedSendAt: z.string().datetime().optional(),
});

const ProposeReplyInput = z.object({
  conversationId: z.string().min(1).max(64),
  draftBody: z.string().min(1).max(20_000),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

const EmptyInput = z.object({});

@Injectable()
export class OutreachAdminTools {
  constructor(@Inject(OutreachService) private readonly outreach: OutreachService) {}

  @McpTool({
    name: 'outreach_list_campaigns',
    title: 'Outreach: List campaigns',
    description:
      'List outbound-campaign definitions for this org. Each row carries the brief, the targeted CRM segment, the email channel used to send, cadence rules, CTA URL, and the enabled flag. The draft-initial curator only drafts proposals for `enabled = true` campaigns.',
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listCampaigns() {
    return this.outreach.listCampaigns();
  }

  @McpTool({
    name: 'outreach_get_campaign',
    title: 'Outreach: Read one campaign',
    description: 'Read a single campaign by id, including brief and cadence rules.',
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: GetCampaignInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getCampaign(args: z.infer<typeof GetCampaignInput>) {
    return this.outreach.getCampaign(args.id);
  }

  @McpTool({
    name: 'outreach_create_campaign',
    title: 'Outreach: Create campaign',
    description:
      'Create an outbound-campaign definition. Operators write `brief` as a one-paragraph human description of intent (the curator personalises per contact from this). `segmentId` chooses the audience; the curator calls `crm_list_contacts_in_segment` (which always enforces suppression+consent floor) to materialize it. `channelId` must reference an email channel. New campaigns default `enabled: false` so the curator does not start drafting until you flip it on.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: CreateCampaignInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  createCampaign(args: z.infer<typeof CreateCampaignInput>) {
    return this.outreach.createCampaign(args);
  }

  @McpTool({
    name: 'outreach_update_campaign',
    title: 'Outreach: Update campaign',
    description: 'Patch fields on a campaign — rename, swap segment, adjust cadence, toggle enabled.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: UpdateCampaignInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  updateCampaign(args: z.infer<typeof UpdateCampaignInput>) {
    return this.outreach.updateCampaign(args);
  }

  @McpTool({
    name: 'outreach_list_proposals',
    title: 'Outreach: List proposals',
    description:
      'List drafted outreach proposals (initials in PR2; replies in PR3). Defaults to all statuses. The draft-initial curator queries `status: "pending", kind: "initial"` filtered by `(campaignId, contactId)` to dedupe before drafting a new candidate. The operator review surface queries `status: "pending"`.',
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: ListProposalsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listProposals(args: z.infer<typeof ListProposalsInput>) {
    return this.outreach.listProposals(args);
  }

  @McpTool({
    name: 'outreach_propose_initial',
    title: 'Outreach: Propose an initial draft',
    description:
      'File one drafted initial outreach email per (campaign, contact) for human approval. Idempotent: re-proposing the same (campaign, contact, kind=initial) while a pending row exists throws — call `outreach_list_proposals` first to dedupe. Suppression and consent are re-checked at approve-time too; this tool refuses up-front if the contact is already suppressed.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: ProposeInitialInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  proposeInitial(args: z.infer<typeof ProposeInitialInput>) {
    return this.outreach.proposeInitial(args);
  }

  @McpTool({
    name: 'outreach_propose_reply',
    title: 'Outreach: Propose an reply draft',
    description:
      "File a drafted reply to an inbound message on an outreach-originated conversation, for human approval. The conversation must have an `outreachCampaignId` set (it's an outreach conversation) and a CRM contact resolvable by email. Idempotent: re-proposing while a pending reply exists for the same conversation throws — the operator should approve or dismiss the existing one first. Reply approvals send via `conv_send_message` on the existing conversation; no unsubscribe footer is appended (replies thread inside the existing email chain that already carries the unsubscribe link).",
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: ProposeReplyInput,
    readOnlyHint: false,
    destructiveHint: false,
  })
  proposeReply(args: z.infer<typeof ProposeReplyInput>) {
    return this.outreach.proposeReply(args);
  }
}
