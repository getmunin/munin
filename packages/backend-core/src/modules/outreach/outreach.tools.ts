import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { readApiBaseUrl } from '@getmunin/core';
import {
  OutreachInvalidError,
  OutreachService,
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
} from './outreach.service.ts';
import { IdMapSchema } from '../../common/transfer/transfer.types.ts';
import { INSPECTOR_APP_URI } from '../../mcp/inspector.resource.ts';

function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const IanaTimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(isKnownTimeZone, { message: 'must be an IANA time zone, e.g. "Europe/Oslo"' });

const CadenceRulesSchema = z.object({
  maxPerWeekPerContact: z.number().int().positive().max(7).optional(),
  quietHoursStart: z.string().regex(/^[0-2]\d:[0-5]\d$/).optional(),
  quietHoursEnd: z.string().regex(/^[0-2]\d:[0-5]\d$/).optional(),
  quietHoursTimezone: IanaTimeZone.optional().describe(
    'IANA time zone the quiet hours and blackout dates are read in, e.g. "Europe/Oslo". Defaults to UTC.',
  ),
  blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(50).optional(),
});

const SequenceStepSchema = z.object({
  waitDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .describe('Days to wait after the previous outbound with no reply before this step is due.'),
  brief: z
    .string()
    .min(1)
    .max(2000)
    .describe('Goal/angle for this step, e.g. "gentle bump" or "share a relevant case study".'),
});

const SequenceStepsSchema = z.array(SequenceStepSchema).max(5);

const CreateCampaignInput = z.object({
  name: z.string().min(1).max(120),
  brief: z.string().min(1).max(5000),
  segmentId: z.string().min(1).max(64),
  channelId: z.string().min(1).max(64),
  cadenceRules: CadenceRulesSchema.optional(),
  sequenceSteps: SequenceStepsSchema.optional(),
  ctaUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
  autoDraftFirstTouch: z.boolean().optional(),
  autoDraftReplies: z.boolean().optional(),
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
      sequenceSteps: SequenceStepsSchema.optional(),
      ctaUrl: z.string().url().nullable().optional(),
      enabled: z.boolean().optional(),
      autoDraftFirstTouch: z.boolean().optional(),
      autoDraftReplies: z.boolean().optional(),
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
  limit: z.number().int().positive().max(200).optional().describe('Defaults to 25.'),
});

const GetProposalInput = z.object({ id: z.string().min(1).max(64) });

const ProposeInitialInput = z.object({
  campaignId: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
  draftSubject: z
    .string()
    .max(300)
    .optional()
    .describe(
      'Required for email campaigns; omit for SMS and voice campaigns, which have no subject.',
    ),
  draftBody: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      'For email campaigns: the email body. For SMS campaigns: the text message, capped at 480 characters, plain text — no markdown, and no opt-out line, which Munin appends. For voice campaigns: the opening line / talking-points the AI agent should use when the call connects.',
    ),
  evidence: z.record(z.string(), z.unknown()).optional(),
  proposedSendAt: z
    .string()
    .datetime()
    .optional()
    .describe(
      'When this draft should ideally go out, ISO-8601. Advisory: the operator who approves it inherits this time unless they name their own, and a time already in the past is treated as send-now.',
    ),
});

const ProposeReplyInput = z.object({
  conversationId: z.string().min(1).max(64),
  draftBody: z.string().min(1).max(20_000),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

const ProposeFollowupInput = z.object({
  conversationId: z.string().min(1).max(64),
  step: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1-based sequence step to file — must be the next step for this conversation.'),
  draftBody: z.string().min(1).max(20_000),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

const ListDueFollowupsInput = z.object({
  campaignId: z.string().min(1).max(64).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const EmptyInput = z.object({});

const ApproveProposalInput = z.object({
  id: z.string().min(1).max(64),
  fingerprint: z
    .string()
    .min(1)
    .max(64)
    .describe(
      'The `draftFingerprint` carried by the proposal as it was read, binding this approval to that exact draft.',
    ),
  sendAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe(
      'When the approved message should go out, ISO-8601 and in the future. Omit to use the time the draft carries in `proposedSendAt`, or to send now when it carries none. Pass null to send now even though the draft proposes a later time.',
    ),
});

const CancelScheduledSendInput = z.object({
  id: z.string().min(1).max(64),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe('Why the scheduled send is being called off. Recorded on the audit trail.'),
});

const DismissProposalInput = z.object({
  id: z.string().min(1).max(64),
  reason: z.string().max(500).optional(),
});

const ReviseProposalInput = z
  .object({
    id: z.string().min(1).max(64),
    reason: z
      .string()
      .min(1)
      .max(500)
      .describe('Why the draft is being changed. Recorded on the proposal and shown to reviewers.'),
    draftSubject: z.string().max(300).nullable().optional(),
    draftBody: z.string().min(1).max(20_000).optional(),
    proposedSendAt: z.string().datetime().nullable().optional(),
  })
  .refine(
    (v) =>
      v.draftSubject !== undefined || v.draftBody !== undefined || v.proposedSendAt !== undefined,
    { message: 'pass at least one of draftSubject, draftBody, proposedSendAt' },
  );

const WithdrawProposalInput = z.object({
  id: z.string().min(1).max(64),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe('Why the draft is being retracted, e.g. "duplicate of oprp_… " or "address bounced".'),
});

const OutreachImportInput = z.object({
  records: z.object({
    campaigns: z.array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120),
        brief: z.string().min(1).max(5000),
        segmentId: z.string(),
        channelId: z.string(),
        cadenceRules: CadenceRulesSchema.default({}),
        sequenceSteps: SequenceStepsSchema.default([]),
        ctaUrl: z.string().nullable().optional(),
        autoDraftFirstTouch: z.boolean().default(false),
        autoDraftReplies: z.boolean().default(true),
        unsubscribeRequired: z.boolean(),
      }),
    ),
    proposals: z.array(
      z.object({
        id: z.string(),
        campaignId: z.string(),
        contactId: z.string(),
        conversationId: z.string().nullable().optional(),
        kind: z.enum(PROPOSAL_KINDS),
        sequenceStep: z.number().int().min(1).max(5).nullable().optional(),
        draftSubject: z.string().nullable().optional(),
        draftBody: z.string().min(1),
        evidence: z.record(z.string(), z.unknown()).default({}),
        proposedSendAt: z.string().nullable().optional(),
        status: z.enum(PROPOSAL_STATUSES),
      }),
    ),
  }),
  idMap: IdMapSchema.optional(),
});

@Injectable()
export class OutreachAdminTools {
  constructor(@Inject(OutreachService) private readonly outreach: OutreachService) {}

  @McpTool({
    name: 'outreach_list_campaigns',
    title: 'Outreach: List campaigns',
    description:
      'List outbound-campaign definitions for this org. Each row carries the brief, the targeted CRM segment, the email channel used to send, cadence rules, `sequenceSteps` (ordered follow-up steps drafted by the daily curator when the campaign is enabled; empty means no sequence), CTA URL, the enabled flag, and the two automation flags: `autoDraftFirstTouch` (the weekly curator drafts first-touch emails only when true) and `autoDraftReplies` (replies to inbound prospect messages are auto-drafted only when true). The weekly first-touch curator only drafts proposals for `enabled = true` campaigns with `autoDraftFirstTouch = true`.',
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
      'Create an outbound-campaign definition. Operators write `brief` as a one-paragraph human description of intent (the curator personalises per contact from this). `segmentId` chooses the audience; the curator calls `crm_list_contacts_in_segment` (which always enforces suppression+consent floor) to materialize it. `channelId` must reference an email, SMS, or voice channel; approving a proposal on an SMS or voice campaign is restricted to a signed-in person in the Munin dashboard. New campaigns default `enabled: false` so nothing sends until you flip it on. Automation is opt-in per behavior: `autoDraftFirstTouch` defaults false (the weekly curator does not draft first-touch emails until you set it true — draft manually otherwise), while `autoDraftReplies` defaults true (replies to inbound prospect messages are auto-drafted for review). Auto-sending a reply is not an option on any campaign: conversations created by an approved proposal are always set to `draft_only`, whatever the channel default says, so a prospect never receives an unreviewed reply. Optional `sequenceSteps` (email campaigns only) defines a follow-up sequence — each step is a wait period plus a drafting brief; defining steps on an enabled campaign opts it into daily follow-up drafting for threads with no reply.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: CreateCampaignInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  createCampaign(args: z.infer<typeof CreateCampaignInput>) {
    return this.outreach.createCampaign(args);
  }

  @McpTool({
    name: 'outreach_export',
    title: 'Outreach: Export data',
    description:
      "Export this org's outbound campaigns and their queued proposals as a portable JSON payload. Pair with `outreach_import` on another Munin server. Campaigns reference a CRM segment and a conversation channel, and proposals reference CRM contacts/conversations — so export and import CRM and Conversations first, and thread their `idMap` into `outreach_import`.",
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  exportOutreach() {
    return this.outreach.exportOutreach();
  }

  @McpTool({
    name: 'outreach_import',
    title: 'Outreach: Import data',
    description:
      'Import outreach `records` produced by `outreach_export`. Campaigns are upserted by name and proposals by (campaign, contact, kind) — plus `sequenceStep` for follow-ups — so re-running is idempotent. Segment, channel, contact and conversation foreign keys are resolved through the supplied `idMap` (pass the idMap returned by the CRM and Conversations imports). Campaigns are imported **disabled** — re-enable them after re-entering the channel credentials. Proposals that were approved and awaiting a scheduled send on the source server arrive as `pending` with a warning, so no timer follows the data across servers. Returns counts plus the merged `idMap`.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: OutreachImportInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  importOutreach(args: z.infer<typeof OutreachImportInput>) {
    const records = {
      campaigns: args.records.campaigns.map((c) => ({ ...c, ctaUrl: c.ctaUrl ?? null })),
      proposals: args.records.proposals.map((p) => ({
        ...p,
        conversationId: p.conversationId ?? null,
        sequenceStep: p.sequenceStep ?? null,
        draftSubject: p.draftSubject ?? null,
        proposedSendAt: p.proposedSendAt ?? null,
      })),
    };
    return this.outreach.importOutreach(records, args.idMap);
  }

  @McpTool({
    name: 'outreach_update_campaign',
    title: 'Outreach: Update campaign',
    description:
      'Patch fields on a campaign — rename, swap segment, adjust cadence, toggle enabled, toggle the automation flags `autoDraftFirstTouch` (weekly first-touch drafting) and `autoDraftReplies` (auto-drafting replies to inbound prospect messages), or replace `sequenceSteps` (the follow-up sequence; pass the full array, email campaigns only, empty array removes the sequence).',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: UpdateCampaignInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  updateCampaign(args: z.infer<typeof UpdateCampaignInput>) {
    return this.outreach.updateCampaign(args);
  }

  @McpTool({
    name: 'outreach_list_proposals',
    title: 'Outreach: List proposals',
    description:
      'List drafted outreach proposals, newest first. Defaults to all statuses and to 25 rows; pass `status` and `limit` to narrow. Rows carry the full `draftSubject` / `draftBody` plus nested `contact`, `campaign` and `delivery` summaries, but not the curator `evidence` payload, which can run to thousands of characters per row — a boolean `hasEvidence` says whether there is any, and `outreach_get_proposal` returns it for one proposal. The first-touch curator queries `status: "pending", kind: "initial"` filtered by `(campaignId, contactId)` to dedupe before drafting a new candidate. The operator review surface queries `status: "pending"`. `status: "approved"` lists approved sends still waiting for their `scheduledSendAt`, soonest first. In hosts that support MCP Apps this renders an interactive review panel with per-proposal approve/dismiss actions.',
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: ListProposalsInput,
    readOnlyHint: true,
    destructiveHint: false,
    _meta: { ui: { resourceUri: INSPECTOR_APP_URI }, 'ui/resourceUri': INSPECTOR_APP_URI },
  })
  listProposals(args: z.infer<typeof ListProposalsInput>) {
    return this.outreach.listProposals(args);
  }

  @McpTool({
    name: 'outreach_get_proposal',
    title: 'Outreach: Get proposal',
    description:
      'Read one outreach proposal by id, including the full curator `evidence` payload that `outreach_list_proposals` omits — the sources, compliance notes and reasoning recorded when the draft was filed. Also carries the draft, its status and decision history, and the nested `contact`, `campaign` and `delivery` summaries.',
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: GetProposalInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getProposal(args: z.infer<typeof GetProposalInput>) {
    return this.outreach.getProposal(args.id);
  }

  @McpTool({
    name: 'outreach_approve_proposal',
    title: 'Outreach: Approve proposal',
    description:
      "Approve one pending outreach proposal, authorizing it to go out: an initial proposal creates the outbound conversation and delivers the first touch on the campaign's channel — an email (with CTA and unsubscribe footer per campaign settings), an SMS, or an outbound call placed through the channel's voice vendor; a reply or follow-up proposal sends the draft verbatim on its existing conversation. Sends immediately unless a future send time applies, in which case the proposal returns `status: \"approved\"` with `scheduledSendAt` and a background worker delivers it then, re-checking campaign state, suppression and quiet hours at that moment. The approval is bound to the draft it was given: `fingerprint` must match the proposal's current `draftFingerprint`, so a draft revised since it was read is refused with a conflict and stays pending. Also fails if the proposal is not pending, if the campaign is disabled, if the contact became suppressed since drafting, or — for follow-ups — if the prospect replied after the draft was filed (dismiss it; the reply flow takes over). Returns the proposal with `status: \"sent\"`, `conversationId` and `sentMessageId` on an immediate send.",
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: ApproveProposalInput,
    readOnlyHint: false,
    destructiveHint: true,
    _meta: { ui: { visibility: ['app'] } },
  })
  approveProposal(args: z.infer<typeof ApproveProposalInput>) {
    return translateInvalid(() =>
      this.outreach.approveProposal(args.id, {
        publicBaseUrl: readApiBaseUrl(),
        fingerprint: args.fingerprint,
        sendAt: args.sendAt,
      }),
    );
  }

  @McpTool({
    name: 'outreach_cancel_scheduled_send',
    title: 'Outreach: Cancel scheduled send',
    description:
      'Call off a scheduled outreach send before the worker delivers it, returning the proposal to `status: "pending"` so it goes back on the review queue with its draft and revision history intact. The approval is cleared, so sending it later takes a fresh approval. Nothing is sent and the contact is not suppressed. Fails when the proposal is not an approved, still-scheduled send — a proposal already delivered cannot be recalled. Takes a required `reason`.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: CancelScheduledSendInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  cancelScheduledSend(args: z.infer<typeof CancelScheduledSendInput>) {
    return translateInvalid(() =>
      this.outreach.cancelScheduledSend({ id: args.id, reason: args.reason }),
    );
  }

  @McpTool({
    name: 'outreach_dismiss_proposal',
    title: 'Outreach: Dismiss proposal',
    description:
      'Dismiss one pending outreach proposal without sending, optionally recording a reason. The decision (actor and timestamp) is kept on the proposal for audit. Fails if the proposal is not pending — an approved send waiting on its schedule has to be called off with `outreach_cancel_scheduled_send` first, which puts it back in `pending`. Returns the proposal with `status: "dismissed"`.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: DismissProposalInput,
    readOnlyHint: false,
    destructiveHint: true,
    _meta: { ui: { visibility: ['app'] } },
  })
  dismissProposal(args: z.infer<typeof DismissProposalInput>) {
    return translateInvalid(() =>
      this.outreach.dismissProposal({ id: args.id, reason: args.reason }),
    );
  }

  @McpTool({
    name: 'outreach_revise_proposal',
    title: 'Outreach: Revise proposal',
    description:
      'Rewrite the draft on one pending outreach proposal in place, keeping the same proposal id, campaign, and contact — those three cannot be changed here; a different recipient or campaign is a different proposal. Pass any of `draftSubject`, `draftBody`, `proposedSendAt` plus a required `reason`. The revision is recorded on the proposal: `revisionCount`, `lastRevisedAt`, `lastRevisionReason`, and the revising actor, plus `revisedAfterReviewAt` when someone else had already opened the draft for review before the change. `proposedSendAt` is the send time an operator inherits when they approve without naming one of their own. Fails if the proposal is not pending — an approved send waiting on its schedule has to be called off with `outreach_cancel_scheduled_send` before its draft can change. Returns the revised proposal.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: ReviseProposalInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  reviseProposal(args: z.infer<typeof ReviseProposalInput>) {
    return translateInvalid(() =>
      this.outreach.reviseProposal({
        id: args.id,
        reason: args.reason,
        draftSubject: args.draftSubject,
        draftBody: args.draftBody,
        proposedSendAt: args.proposedSendAt,
      }),
    );
  }

  @McpTool({
    name: 'outreach_withdraw_proposal',
    title: 'Outreach: Withdraw proposal',
    description:
      'Retract one pending outreach proposal that should no longer be reviewed — a duplicate draft, a prospect who turned out not to qualify, a bounced address. Nothing is sent. This is a neutral retraction, not a rejection: it does not suppress the contact, does not change their consent, and does not stop a campaign sequence (a withdrawn follow-up leaves later steps eligible, unlike a dismissed one). A required `reason` and the withdrawing actor are recorded. Fails if the proposal is not pending. Returns the proposal with `status: "withdrawn"`.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: WithdrawProposalInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  withdrawProposal(args: z.infer<typeof WithdrawProposalInput>) {
    return translateInvalid(() =>
      this.outreach.withdrawProposal({ id: args.id, reason: args.reason }),
    );
  }

  @McpTool({
    name: 'outreach_propose_first_touch',
    title: 'Outreach: Propose first touch',
    description:
      'File one first-touch outreach draft per (campaign, contact) for human approval — an email body, an SMS body, or the script for an outbound call, depending on the channel the campaign sends on. Idempotent: re-proposing the same (campaign, contact, kind=initial) throws when a pending draft already exists, or when the contact already has a sent or approved first-touch in this campaign (they were already reached) — call `outreach_list_proposals` first to dedupe. Suppression and consent are re-checked at approve-time too; this tool refuses up-front if the contact is already suppressed.',
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: ProposeInitialInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  proposeInitial(args: z.infer<typeof ProposeInitialInput>) {
    return this.outreach.proposeInitial(args);
  }

  @McpTool({
    name: 'outreach_propose_reply',
    title: 'Outreach: Propose reply',
    description:
      "File a drafted reply to an inbound message on an outreach-originated conversation, for human approval. The conversation must have an `outreachCampaignId` set (it's an outreach conversation) and a CRM contact resolvable by email. Idempotent: re-proposing while a pending reply exists for the same conversation throws — the operator should approve or dismiss the existing one first. Reply approvals send via `conv_send_message` on the existing conversation; no unsubscribe footer is appended (replies thread inside the existing email chain that already carries the unsubscribe link).",
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: ProposeReplyInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  proposeReply(args: z.infer<typeof ProposeReplyInput>) {
    return this.outreach.proposeReply(args);
  }

  @McpTool({
    name: 'outreach_list_due_followups',
    title: 'Outreach: List due follow-ups',
    description:
      "List outreach conversations whose next sequence step is due now. A row is returned when the campaign is enabled with a `sequenceSteps` entry beyond the last sent outbound, the wait period has elapsed with zero inbound replies, the conversation is open and unassigned, the contact is not suppressed, and no pending follow-up/reply or dismissed step blocks it. Campaign cadence rules are also honored: a contact at their `maxPerWeekPerContact` budget of sent touches in the trailing 7 days is held back, and nothing is due on a `blackoutDates` day (quiet hours are a send-time concern and do not gate drafting). Each row carries `conversationId`, `nextStep`, and the step brief — everything needed to draft and file the follow-up via `outreach_propose_followup`. An empty result means no sequence work is due.",
    audiences: ['admin'],
    scopes: ['outreach:read'],
    input: ListDueFollowupsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listDueFollowups(args: z.infer<typeof ListDueFollowupsInput>) {
    return this.outreach.listDueFollowups(args);
  }

  @McpTool({
    name: 'outreach_propose_followup',
    title: 'Outreach: Propose follow-up',
    description:
      "File a drafted sequence follow-up (step N of the campaign's `sequenceSteps`) on an outreach conversation, for human approval. Follow-up sequences run on email campaigns only. `step` must be the next step for the conversation, its wait period must have elapsed, and the prospect must not have replied — any inbound reply permanently stops the sequence (the reply flow owns the conversation). One pending follow-up per (campaign, contact); a dismissed follow-up permanently stops the sequence for that contact, so operators who dislike the wording should edit-then-approve instead. Approving sends on the existing conversation with no subject or unsubscribe footer (the thread already carries both).",
    audiences: ['admin'],
    scopes: ['outreach:write'],
    input: ProposeFollowupInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  proposeFollowup(args: z.infer<typeof ProposeFollowupInput>) {
    return this.outreach.proposeFollowup(args);
  }
}

async function translateInvalid<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OutreachInvalidError) throw new BadRequestException(err.message);
    throw err;
  }
}
