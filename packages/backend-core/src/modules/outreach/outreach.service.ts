import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { getCurrentContext, signUnsubscribeToken, WebhookDispatcher } from '@getmunin/core';
import { ConvService } from '../conv/conv.service.js';
import { CrmService, CrmInvalidError } from '../crm/crm.service.js';
import { EmailService } from '../conv/email/email.service.js';

export class OutreachInvalidError extends Error {
  readonly code = 'outreach_invalid';
  constructor(message: string) {
    super(`outreach_invalid: ${message}`);
  }
}

export const PROPOSAL_KINDS = ['initial', 'reply'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ['pending', 'approved', 'sent', 'failed', 'dismissed'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface CadenceRules {
  maxPerWeekPerContact?: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  blackoutDates?: string[];
}

export interface CampaignDto {
  id: string;
  name: string;
  brief: string;
  segmentId: string;
  channelId: string;
  cadenceRules: CadenceRules;
  ctaUrl: string | null;
  enabled: boolean;
  unsubscribeRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalContactSummary {
  id: string;
  name: string | null;
  email: string | null;
  companyId: string | null;
}

export interface ProposalCampaignSummary {
  id: string;
  name: string;
}

export interface ProposalDto {
  id: string;
  campaignId: string;
  contactId: string;
  conversationId: string | null;
  kind: ProposalKind;
  draftSubject: string | null;
  draftBody: string;
  evidence: Record<string, unknown>;
  proposedSendAt: string | null;
  status: ProposalStatus;
  proposedByActorType: string;
  proposedByActorId: string;
  decidedByActorType: string | null;
  decidedByActorId: string | null;
  decidedAt: string | null;
  sentAt: string | null;
  sentMessageId: string | null;
  failureReason: string | null;
  dismissReason: string | null;
  createdAt: string;
  updatedAt: string;
  contact: ProposalContactSummary | null;
  campaign: ProposalCampaignSummary | null;
}

@Injectable()
export class OutreachService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(ConvService) private readonly conv: ConvService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  // ─── Campaigns ──────────────────────────────────────────────────────────

  async listCampaigns(): Promise<CampaignDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.outreachCampaigns)
      .orderBy(desc(schema.outreachCampaigns.updatedAt));
    return rows.map(toCampaignDto);
  }

  async getCampaign(id: string): Promise<CampaignDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.outreachCampaigns)
      .where(eq(schema.outreachCampaigns.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`outreach_not_found: campaign ${id}`);
    return toCampaignDto(rows[0]);
  }

  async createCampaign(input: {
    name: string;
    brief: string;
    segmentId: string;
    channelId: string;
    cadenceRules?: CadenceRules;
    ctaUrl?: string | null;
    enabled?: boolean;
    unsubscribeRequired?: boolean;
  }): Promise<CampaignDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!input.name.trim()) throw new OutreachInvalidError('name must be non-empty');
    if (!input.brief.trim()) throw new OutreachInvalidError('brief must be non-empty');
    // Validate FK targets in this org.
    await this.assertSegmentExists(input.segmentId);
    await this.assertEmailChannelExists(input.channelId);
    try {
      const [row] = await ctx.db
        .insert(schema.outreachCampaigns)
        .values({
          orgId: actor.orgId,
          name: input.name,
          brief: input.brief,
          segmentId: input.segmentId,
          channelId: input.channelId,
          cadenceRules: input.cadenceRules ?? {},
          ctaUrl: input.ctaUrl ?? null,
          enabled: input.enabled ?? false,
          unsubscribeRequired: input.unsubscribeRequired ?? true,
          createdByActorType: actor.type,
          createdByActorId: actor.id,
        })
        .returning();
      return toCampaignDto(row!);
    } catch (err) {
      if (isUniqueViolation(err, 'outreach_campaigns_org_name_uq')) {
        throw new ConflictException(`outreach_conflict: campaign with name "${input.name}" already exists`);
      }
      throw err;
    }
  }

  async updateCampaign(input: {
    id: string;
    patch: Partial<{
      name: string;
      brief: string;
      segmentId: string;
      channelId: string;
      cadenceRules: CadenceRules;
      ctaUrl: string | null;
      enabled: boolean;
      unsubscribeRequired: boolean;
    }>;
  }): Promise<CampaignDto> {
    const ctx = getCurrentContext();
    if (input.patch.segmentId) await this.assertSegmentExists(input.patch.segmentId);
    if (input.patch.channelId) await this.assertEmailChannelExists(input.patch.channelId);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(input.patch)) {
      if (v !== undefined) updates[k] = v;
    }
    const result = await ctx.db
      .update(schema.outreachCampaigns)
      .set(updates)
      .where(eq(schema.outreachCampaigns.id, input.id))
      .returning();
    if (!result[0]) throw new NotFoundException(`outreach_not_found: campaign ${input.id}`);
    return toCampaignDto(result[0]);
  }

  // ─── Proposals ──────────────────────────────────────────────────────────

  async listProposals(input: {
    status?: ProposalStatus;
    campaignId?: string;
    kind?: ProposalKind;
    contactId?: string;
    limit?: number;
  }): Promise<ProposalDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 100, 500);
    const filters: SQL[] = [];
    if (input.status) filters.push(eq(schema.outreachProposals.status, input.status));
    if (input.campaignId) filters.push(eq(schema.outreachProposals.campaignId, input.campaignId));
    if (input.kind) filters.push(eq(schema.outreachProposals.kind, input.kind));
    if (input.contactId) filters.push(eq(schema.outreachProposals.contactId, input.contactId));
    const rows = await ctx.db
      .select({
        proposal: schema.outreachProposals,
        contact: {
          id: schema.crmContacts.id,
          name: schema.crmContacts.name,
          email: schema.crmContacts.email,
          companyId: schema.crmContacts.companyId,
        },
        campaign: {
          id: schema.outreachCampaigns.id,
          name: schema.outreachCampaigns.name,
        },
      })
      .from(schema.outreachProposals)
      .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, schema.outreachProposals.contactId))
      .leftJoin(
        schema.outreachCampaigns,
        eq(schema.outreachCampaigns.id, schema.outreachProposals.campaignId),
      )
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(schema.outreachProposals.createdAt))
      .limit(limit);
    return rows.map((r) => toProposalDto(r.proposal, r.contact, r.campaign));
  }

  async getProposal(id: string): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        proposal: schema.outreachProposals,
        contact: {
          id: schema.crmContacts.id,
          name: schema.crmContacts.name,
          email: schema.crmContacts.email,
          companyId: schema.crmContacts.companyId,
        },
        campaign: {
          id: schema.outreachCampaigns.id,
          name: schema.outreachCampaigns.name,
        },
      })
      .from(schema.outreachProposals)
      .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, schema.outreachProposals.contactId))
      .leftJoin(
        schema.outreachCampaigns,
        eq(schema.outreachCampaigns.id, schema.outreachProposals.campaignId),
      )
      .where(eq(schema.outreachProposals.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`outreach_not_found: proposal ${id}`);
    return toProposalDto(rows[0].proposal, rows[0].contact, rows[0].campaign);
  }

  async proposeInitial(input: {
    campaignId: string;
    contactId: string;
    draftSubject: string;
    draftBody: string;
    evidence?: Record<string, unknown>;
    proposedSendAt?: string;
  }): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!input.draftSubject.trim()) throw new OutreachInvalidError('draftSubject must be non-empty');
    if (!input.draftBody.trim()) throw new OutreachInvalidError('draftBody must be non-empty');
    // Validate FKs.
    await this.getCampaign(input.campaignId);
    const contact = await this.crm.getContact(input.contactId).catch((err) => {
      if (err instanceof CrmInvalidError) throw new OutreachInvalidError(err.message);
      throw err;
    });
    if (contact.doNotContact || contact.unsubscribedAt || !contact.consentLawfulBasis) {
      throw new OutreachInvalidError(
        `contact ${input.contactId} is suppressed or has no recorded lawful basis`,
      );
    }
    try {
      const [row] = await ctx.db
        .insert(schema.outreachProposals)
        .values({
          orgId: actor.orgId,
          campaignId: input.campaignId,
          contactId: input.contactId,
          kind: 'initial',
          draftSubject: input.draftSubject,
          draftBody: input.draftBody,
          evidence: input.evidence ?? {},
          proposedSendAt: input.proposedSendAt ? new Date(input.proposedSendAt) : null,
          status: 'pending',
          proposedByActorType: actor.type,
          proposedByActorId: actor.id,
        })
        .returning();
      await this.webhooks.emit({
        type: 'outreach.proposal.created',
        payload: {
          proposalId: row!.id,
          campaignId: row!.campaignId,
          contactId: row!.contactId,
          kind: row!.kind,
        },
      });
      return toProposalDto(row!);
    } catch (err) {
      if (isUniqueViolation(err, 'outreach_proposals_pending_pair_uq')) {
        throw new ConflictException(
          `outreach_conflict: a pending initial proposal already exists for (campaign, contact)`,
        );
      }
      throw err;
    }
  }

  async proposeReply(input: {
    conversationId: string;
    draftBody: string;
    evidence?: Record<string, unknown>;
  }): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!input.draftBody.trim()) throw new OutreachInvalidError('draftBody must be non-empty');
    const conv = await this.conv.getConversation(input.conversationId);
    if (!conv.outreachCampaignId) {
      throw new OutreachInvalidError(
        `conversation ${input.conversationId} is not outreach-originated (no campaign attached)`,
      );
    }
    if (!conv.contactId) {
      throw new OutreachInvalidError(
        `conversation ${input.conversationId} has no contact bound — cannot file reply draft`,
      );
    }
    // The conversation's contactId is conv_contacts.id, but the proposal's
    // contactId is crm_contacts.id. Resolve via email match.
    const convContactRows = await ctx.db
      .select({ email: schema.convContacts.email })
      .from(schema.convContacts)
      .where(eq(schema.convContacts.id, conv.contactId))
      .limit(1);
    const email = convContactRows[0]?.email;
    if (!email) {
      throw new OutreachInvalidError(
        `conv contact ${conv.contactId} has no email — cannot resolve to a CRM contact`,
      );
    }
    const crmContact = await this.crm.findContact({ email });
    if (!crmContact) {
      throw new OutreachInvalidError(
        `no CRM contact found for ${email} on conversation ${input.conversationId}`,
      );
    }
    try {
      const [row] = await ctx.db
        .insert(schema.outreachProposals)
        .values({
          orgId: actor.orgId,
          campaignId: conv.outreachCampaignId,
          contactId: crmContact.id,
          conversationId: input.conversationId,
          kind: 'reply',
          draftBody: input.draftBody,
          evidence: input.evidence ?? {},
          status: 'pending',
          proposedByActorType: actor.type,
          proposedByActorId: actor.id,
        })
        .returning();
      await this.webhooks.emit({
        type: 'outreach.proposal.created',
        payload: {
          proposalId: row!.id,
          campaignId: row!.campaignId,
          contactId: row!.contactId,
          conversationId: row!.conversationId,
          kind: row!.kind,
        },
      });
      return toProposalDto(row!);
    } catch (err) {
      if (isUniqueViolation(err, 'outreach_proposals_pending_pair_uq')) {
        throw new ConflictException(
          `outreach_conflict: a pending reply proposal already exists for this conversation`,
        );
      }
      throw err;
    }
  }

  async approveProposal(id: string, opts: { publicBaseUrl: string }): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const proposal = await this.getProposal(id);
    if (proposal.status !== 'pending') {
      throw new OutreachInvalidError(`proposal ${id} is ${proposal.status}, not pending`);
    }
    if (proposal.kind === 'initial') {
      return this.approveInitial(proposal, actor, opts);
    }
    return this.approveReply(proposal, actor);
  }

  private async approveInitial(
    proposal: ProposalDto,
    actor: NonNullable<ReturnType<typeof getCurrentContext>['actor']>,
    opts: { publicBaseUrl: string },
  ): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const campaign = await this.getCampaign(proposal.campaignId);
    if (!campaign.enabled) {
      throw new OutreachInvalidError(`campaign ${campaign.id} is disabled`);
    }

    // Re-check suppression+consent at approve-time (the contact may have
    // unsubscribed between draft generation and operator approval).
    const contact = await this.crm.getContact(proposal.contactId);
    if (contact.doNotContact || contact.unsubscribedAt || !contact.consentLawfulBasis) {
      throw new OutreachInvalidError(
        `contact ${contact.id} is no longer eligible (suppression or consent withdrawn)`,
      );
    }
    if (!contact.email) {
      throw new OutreachInvalidError(`contact ${contact.id} has no email — cannot send`);
    }

    // Find or create a conv_contacts row keyed on email so the email
    // adapter's reply-threading can link inbound replies back here.
    const convContact = await ctx.db.transaction(async (tx) => {
      return this.email.findOrCreateContactByEmail(tx, actor.orgId, contact.email!, contact.name ?? undefined);
    });

    const unsubscribeUrl = buildUnsubscribeUrl({
      publicBaseUrl: opts.publicBaseUrl,
      orgId: actor.orgId,
      contactId: contact.id,
      campaignId: campaign.id,
    });
    const body = composeOutreachBody({
      draftBody: proposal.draftBody,
      ctaUrl: campaign.ctaUrl,
      unsubscribeUrl,
      unsubscribeRequired: campaign.unsubscribeRequired,
    });

    // Create the conversation in `agentMode='draft_only'` so the AI runner
    // defers on subsequent inbound messages — replies should be drafted by
    // `skill://outreach/draft-reply` and human-approved, not auto-sent.
    const conversation = await this.conv.createConversation({
      channelId: campaign.channelId,
      body,
      subject: proposal.draftSubject ?? undefined,
      contactId: convContact.id,
      endUserId: contact.endUserId ?? undefined,
      outreachCampaignId: campaign.id,
      agentMode: 'draft_only',
      authorType: 'agent',
      authorId: actor.id,
    });

    const firstMessageId = conversation.messages[0]?.id ?? null;

    const [updated] = await ctx.db
      .update(schema.outreachProposals)
      .set({
        status: 'sent',
        conversationId: conversation.id,
        sentMessageId: firstMessageId,
        sentAt: new Date(),
        decidedByActorType: actor.type,
        decidedByActorId: actor.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.outreachProposals.id, proposal.id))
      .returning();

    await ctx.db
      .update(schema.crmContacts)
      .set({ lastContactedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.crmContacts.id, contact.id));

    await this.webhooks.emit({
      type: 'outreach.proposal.sent',
      payload: {
        proposalId: proposal.id,
        campaignId: campaign.id,
        contactId: contact.id,
        conversationId: conversation.id,
        messageId: firstMessageId,
      },
    });

    return toProposalDto(updated!);
  }

  private async approveReply(
    proposal: ProposalDto,
    actor: NonNullable<ReturnType<typeof getCurrentContext>['actor']>,
  ): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    if (!proposal.conversationId) {
      throw new OutreachInvalidError(
        `reply proposal ${proposal.id} has no conversationId — cannot send`,
      );
    }
    // No unsubscribe footer on replies — the original initial already
    // carries the link, and replies thread inside the same conversation.
    const sent = await this.conv.sendMessage({
      conversationId: proposal.conversationId,
      body: proposal.draftBody,
      authorType: 'agent',
      authorId: actor.id,
    });

    const [updated] = await ctx.db
      .update(schema.outreachProposals)
      .set({
        status: 'sent',
        sentMessageId: sent.id,
        sentAt: new Date(),
        decidedByActorType: actor.type,
        decidedByActorId: actor.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.outreachProposals.id, proposal.id))
      .returning();

    await ctx.db
      .update(schema.crmContacts)
      .set({ lastContactedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.crmContacts.id, proposal.contactId));

    await this.webhooks.emit({
      type: 'outreach.proposal.sent',
      payload: {
        proposalId: proposal.id,
        campaignId: proposal.campaignId,
        contactId: proposal.contactId,
        conversationId: proposal.conversationId,
        messageId: sent.id,
      },
    });

    return toProposalDto(updated!);
  }

  async updateProposal(input: {
    id: string;
    draftSubject?: string | null;
    draftBody?: string;
  }): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const proposal = await this.getProposal(input.id);
    if (proposal.status !== 'pending') {
      throw new OutreachInvalidError(`proposal ${input.id} is ${proposal.status}, not pending`);
    }
    if (input.draftBody !== undefined && input.draftBody.trim().length === 0) {
      throw new OutreachInvalidError('draftBody cannot be empty');
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.draftSubject !== undefined) patch.draftSubject = input.draftSubject;
    if (input.draftBody !== undefined) patch.draftBody = input.draftBody;
    const [updated] = await ctx.db
      .update(schema.outreachProposals)
      .set(patch)
      .where(eq(schema.outreachProposals.id, input.id))
      .returning();
    await this.webhooks.emit({
      type: 'outreach.proposal.updated',
      payload: {
        proposalId: input.id,
        campaignId: proposal.campaignId,
        contactId: proposal.contactId,
      },
    });
    return toProposalDto(updated!);
  }

  async dismissProposal(input: { id: string; reason?: string }): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const proposal = await this.getProposal(input.id);
    if (proposal.status !== 'pending') {
      throw new OutreachInvalidError(`proposal ${input.id} is ${proposal.status}, not pending`);
    }
    const [updated] = await ctx.db
      .update(schema.outreachProposals)
      .set({
        status: 'dismissed',
        dismissReason: input.reason ?? null,
        decidedByActorType: actor.type,
        decidedByActorId: actor.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.outreachProposals.id, input.id))
      .returning();
    await this.webhooks.emit({
      type: 'outreach.proposal.dismissed',
      payload: {
        proposalId: input.id,
        campaignId: proposal.campaignId,
        contactId: proposal.contactId,
        reason: input.reason ?? null,
      },
    });
    return toProposalDto(updated!);
  }

  // ─── Internal helpers ───────────────────────────────────────────────────

  private async assertSegmentExists(segmentId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.crmSegments.id })
      .from(schema.crmSegments)
      .where(eq(schema.crmSegments.id, segmentId))
      .limit(1);
    if (!rows[0]) throw new OutreachInvalidError(`segment ${segmentId} does not exist`);
  }

  private async assertEmailChannelExists(channelId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.convChannels.id, type: schema.convChannels.type })
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    if (!rows[0]) throw new OutreachInvalidError(`channel ${channelId} does not exist`);
    if (rows[0].type !== 'email') {
      throw new OutreachInvalidError(
        `channel ${channelId} is type=${rows[0].type}; outreach campaigns require an email channel`,
      );
    }
  }
}

// ─── DTO mappers / helpers ────────────────────────────────────────────────

function toCampaignDto(row: typeof schema.outreachCampaigns.$inferSelect): CampaignDto {
  return {
    id: row.id,
    name: row.name,
    brief: row.brief,
    segmentId: row.segmentId,
    channelId: row.channelId,
    cadenceRules: row.cadenceRules,
    ctaUrl: row.ctaUrl,
    enabled: row.enabled,
    unsubscribeRequired: row.unsubscribeRequired,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProposalDto(
  row: typeof schema.outreachProposals.$inferSelect,
  contact: { id: string | null; name: string | null; email: string | null; companyId: string | null } | null = null,
  campaign: { id: string | null; name: string | null } | null = null,
): ProposalDto {
  return {
    id: row.id,
    campaignId: row.campaignId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    kind: row.kind as ProposalKind,
    draftSubject: row.draftSubject,
    draftBody: row.draftBody,
    evidence: row.evidence,
    proposedSendAt: row.proposedSendAt?.toISOString() ?? null,
    status: row.status as ProposalStatus,
    proposedByActorType: row.proposedByActorType,
    proposedByActorId: row.proposedByActorId,
    decidedByActorType: row.decidedByActorType,
    decidedByActorId: row.decidedByActorId,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    sentMessageId: row.sentMessageId,
    failureReason: row.failureReason,
    dismissReason: row.dismissReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contact:
      contact && contact.id
        ? { id: contact.id, name: contact.name, email: contact.email, companyId: contact.companyId }
        : null,
    campaign: campaign && campaign.id ? { id: campaign.id, name: campaign.name ?? '' } : null,
  };
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  const target = (cause && typeof cause === 'object' ? cause : err) as {
    code?: string;
    constraint_name?: string;
  };
  return target.code === '23505' && target.constraint_name === constraint;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}

function buildUnsubscribeUrl(input: {
  publicBaseUrl: string;
  orgId: string;
  contactId: string;
  campaignId: string;
}): string {
  const token = signUnsubscribeToken({
    orgId: input.orgId,
    contactId: input.contactId,
    campaignId: input.campaignId,
  });
  const base = input.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/api/v1/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
}

function composeOutreachBody(input: {
  draftBody: string;
  ctaUrl: string | null;
  unsubscribeUrl: string;
  unsubscribeRequired: boolean;
}): string {
  let body = input.draftBody.trimEnd();
  if (input.ctaUrl) {
    body += `\n\n${input.ctaUrl}`;
  }
  if (input.unsubscribeRequired) {
    body += `\n\n---\nUnsubscribe: ${input.unsubscribeUrl}`;
  }
  return body;
}
