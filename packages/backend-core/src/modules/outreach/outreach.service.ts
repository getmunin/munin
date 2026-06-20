import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { makeId, schema, type Db } from '@getmunin/db';
import { DB } from '../../common/db/db.module.ts';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { newImportResult, resolveId } from '../../common/transfer/transfer.helpers.ts';
import type { IdMap, ImportResult } from '../../common/transfer/transfer.types.ts';
import {
  ActorIdentity,
  getCurrentContext,
  signUnsubscribeToken,
  WebhookDispatcher,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { ConvService } from '../conv/conv.service.ts';
import { CrmService, CrmInvalidError } from '../crm/crm.service.ts';
import { EmailService } from '../conv/email/email.service.ts';
import { VapiClientService } from '../conv/vapi/vapi-client.service.ts';
import { jsonbToStored as vapiJsonbToStored } from '../conv/vapi/vapi.service.ts';

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

export interface OutreachCampaignExport {
  id: string;
  name: string;
  brief: string;
  segmentId: string;
  channelId: string;
  cadenceRules: CadenceRules;
  ctaUrl: string | null;
  unsubscribeRequired: boolean;
}

export interface OutreachProposalExport {
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
}

export interface OutreachExportData {
  campaigns: OutreachCampaignExport[];
  proposals: OutreachProposalExport[];
}

@Injectable()
export class OutreachService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(ConvService) private readonly conv: ConvService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(VapiClientService) private readonly vapi: VapiClientService,
    @Inject(DB) private readonly db: Db,
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
    await this.loadOutreachChannel(input.channelId);
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
    if (input.patch.channelId) await this.loadOutreachChannel(input.patch.channelId);
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
    draftSubject?: string | null;
    draftBody: string;
    evidence?: Record<string, unknown>;
    proposedSendAt?: string;
  }): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!input.draftBody.trim()) throw new OutreachInvalidError('draftBody must be non-empty');
    const campaign = await this.getCampaign(input.campaignId);
    const channel = await this.loadOutreachChannel(campaign.channelId);
    if (channel.type === 'email') {
      if (!input.draftSubject?.trim()) {
        throw new OutreachInvalidError('draftSubject must be non-empty for email campaigns');
      }
    }
    const contact = await this.crm.getContact(input.contactId).catch((err) => {
      if (err instanceof CrmInvalidError) throw new OutreachInvalidError(err.message);
      throw err;
    });
    if (contact.doNotContact || contact.unsubscribedAt || !contact.consentLawfulBasis) {
      throw new OutreachInvalidError(
        `contact ${input.contactId} is suppressed or has no recorded lawful basis`,
      );
    }
    if (channel.type === 'voice' && !contact.phone) {
      throw new OutreachInvalidError(
        `contact ${input.contactId} has no phone number — required for voice campaigns`,
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
          draftSubject: input.draftSubject?.trim() || null,
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
    const replyCampaign = await this.getCampaign(conv.outreachCampaignId);
    const replyChannel = await this.loadOutreachChannel(replyCampaign.channelId);
    if (replyChannel.type !== 'email') {
      throw new OutreachInvalidError(
        `reply proposals are only supported on email campaigns; this conversation is on ${replyChannel.type}:${replyChannel.vendor}`,
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

    const channel = await this.loadOutreachChannel(campaign.channelId);

    // Re-check suppression+consent at approve-time (the contact may have
    // unsubscribed between draft generation and operator approval).
    const contact = await this.crm.getContact(proposal.contactId);
    if (contact.doNotContact || contact.unsubscribedAt || !contact.consentLawfulBasis) {
      throw new OutreachInvalidError(
        `contact ${contact.id} is no longer eligible (suppression or consent withdrawn)`,
      );
    }

    if (channel.type === 'voice') {
      return this.approveInitialVoice(proposal, campaign, contact, channel, actor);
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
    // `skill://outreach/draft-reply-email` and human-approved, not auto-sent.
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

  private async approveInitialVoice(
    proposal: ProposalDto,
    campaign: CampaignDto,
    contact: { id: string; name: string | null; phone: string | null },
    channel: typeof schema.convChannels.$inferSelect,
    actor: NonNullable<ReturnType<typeof getCurrentContext>['actor']>,
  ): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    if (!contact.phone) {
      throw new OutreachInvalidError(`contact ${contact.id} has no phone — cannot call`);
    }
    const config = vapiJsonbToStored(channel.config);
    if (!config.phoneNumberId) {
      throw new OutreachInvalidError(
        'voice channel has no phoneNumberId — set one to place outbound PSTN calls',
      );
    }
    const apiKey = await this.vapi.loadSecret(config.encryptedApiKey);
    const callRes = await this.vapi
      .placeCall({
        apiKey,
        assistantId: config.assistantId,
        phoneNumberId: config.phoneNumberId,
        toNumber: contact.phone,
        customer: contact.name ? { name: contact.name } : undefined,
        assistantOverrides: {
          metadata: {
            outreachCampaignId: campaign.id,
            outreachProposalId: proposal.id,
            contactId: contact.id,
            draftOpening: proposal.draftBody,
          },
        },
      })
      .catch((err) => {
        throw new OutreachInvalidError(
          `voice call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    const conv = await this.createVoiceStubConversation({
      orgId: actor.orgId,
      channel,
      contact: { id: contact.id, name: contact.name, phone: contact.phone },
      proposal,
      campaign,
      vapiCallId: callRes.id,
    });

    const [updated] = await ctx.db
      .update(schema.outreachProposals)
      .set({
        status: 'sent',
        conversationId: conv.id,
        sentMessageId: null,
        sentAt: new Date(),
        decidedByActorType: actor.type,
        decidedByActorId: actor.id,
        decidedAt: new Date(),
        evidence: {
          ...(proposal.evidence ?? {}),
          vapiCallId: callRes.id,
          vapiStatus: callRes.status,
        },
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
        conversationId: conv.id,
        messageId: null,
        vapiCallId: callRes.id,
      },
    });

    return toProposalDto(updated!);
  }

  private async createVoiceStubConversation(args: {
    orgId: string;
    channel: typeof schema.convChannels.$inferSelect;
    contact: { id: string; name: string | null; phone: string };
    proposal: ProposalDto;
    campaign: CampaignDto;
    vapiCallId: string;
  }): Promise<{ id: string }> {
    const actor = new ActorIdentity('system', 'outreach-voice', args.orgId, ['*'], ['admin']);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      const requestCtx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      return withContext(requestCtx, async () => {
        const convContactRows = await tx
          .select()
          .from(schema.convContacts)
          .where(
            and(
              eq(schema.convContacts.orgId, args.orgId),
              eq(schema.convContacts.phone, args.contact.phone),
            ),
          )
          .limit(1);
        let convContactId = convContactRows[0]?.id ?? null;
        if (!convContactId) {
          const [created] = await tx
            .insert(schema.convContacts)
            .values({
              orgId: args.orgId,
              phone: args.contact.phone,
              name: args.contact.name,
              metadata: { source: 'outreach-voice', crmContactId: args.contact.id },
            })
            .returning();
          convContactId = created!.id;
        }

        const next = await tx.execute<{ next: number } & Record<string, unknown>>(
          sql`SELECT conv_next_display_id(${args.orgId}) AS next`,
        );
        const displayId = next[0]!.next;
        const stubMetadata = {
          vapiCallId: args.vapiCallId,
          outreachProposalId: args.proposal.id,
          outreachCampaignId: args.campaign.id,
          crmContactId: args.contact.id,
        };
        const newId = makeId('ccv');
        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO conv_conversations
            (id, org_id, display_id, channel_id, contact_id, status, subject,
             outreach_campaign_id, agent_mode, last_message_at, metadata)
          VALUES
            (${newId}, ${args.orgId}, ${displayId}, ${args.channel.id}, ${convContactId},
             'open', NULL, ${args.campaign.id}, 'off',
             ${new Date().toISOString()}, ${JSON.stringify(stubMetadata)}::jsonb)
          ON CONFLICT (org_id, channel_id, ((metadata ->> 'vapiCallId')))
            WHERE (metadata ->> 'vapiCallId') IS NOT NULL
          DO NOTHING
          RETURNING id
        `);
        const insertedId = inserted[0]?.id;
        if (insertedId) return { id: insertedId };
        const existing = await tx
          .select()
          .from(schema.convConversations)
          .where(
            and(
              eq(schema.convConversations.orgId, args.orgId),
              eq(schema.convConversations.channelId, args.channel.id),
              sql`${schema.convConversations.metadata}->>'vapiCallId' = ${args.vapiCallId}`,
            ),
          )
          .limit(1);
        if (!existing[0]) {
          throw new OutreachInvalidError('voice_stub_conv_race_lost_but_missing');
        }
        await tx
          .update(schema.convConversations)
          .set({
            outreachCampaignId: args.campaign.id,
            metadata: { ...(existing[0].metadata), ...stubMetadata },
            updatedAt: new Date(),
          })
          .where(eq(schema.convConversations.id, existing[0].id));
        return { id: existing[0].id };
      });
    });
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

  private async loadOutreachChannel(
    channelId: string,
  ): Promise<typeof schema.convChannels.$inferSelect> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    const channel = rows[0];
    if (!channel) throw new OutreachInvalidError(`channel ${channelId} does not exist`);
    if (channel.type === 'email') return channel;
    if (channel.type === 'voice' && channel.vendor === 'vapi') return channel;
    throw new OutreachInvalidError(
      `channel ${channelId} is ${channel.type}:${channel.vendor}; outreach campaigns require an email or voice:vapi channel`,
    );
  }

  // ─── Transfer (import / export) ───────────────────────────────────────────

  async exportOutreach(): Promise<OutreachExportData> {
    const ctx = getCurrentContext();
    const [campaigns, proposals] = await Promise.all([
      ctx.db.select().from(schema.outreachCampaigns).orderBy(asc(schema.outreachCampaigns.createdAt)),
      ctx.db.select().from(schema.outreachProposals).orderBy(asc(schema.outreachProposals.createdAt)),
    ]);
    return {
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        brief: c.brief,
        segmentId: c.segmentId,
        channelId: c.channelId,
        cadenceRules: c.cadenceRules,
        ctaUrl: c.ctaUrl,
        unsubscribeRequired: c.unsubscribeRequired,
      })),
      proposals: proposals.map((p) => ({
        id: p.id,
        campaignId: p.campaignId,
        contactId: p.contactId,
        conversationId: p.conversationId,
        kind: p.kind as ProposalKind,
        draftSubject: p.draftSubject,
        draftBody: p.draftBody,
        evidence: p.evidence,
        proposedSendAt: p.proposedSendAt ? p.proposedSendAt.toISOString() : null,
        status: p.status as ProposalStatus,
      })),
    };
  }

  async importOutreach(data: OutreachExportData, priorIdMap: IdMap = {}): Promise<ImportResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = newImportResult();
    result.idMap = { ...priorIdMap };

    for (const campaign of data.campaigns) {
      const segmentId = resolveId(result.idMap, campaign.segmentId);
      const channelId = resolveId(result.idMap, campaign.channelId);
      if (!segmentId || !channelId) {
        result.warnings.push(
          `campaign "${campaign.name}" skipped: ${!segmentId ? 'segment' : 'channel'} was not part of this import — import CRM and Conversations first and pass their idMap`,
        );
        result.skipped++;
        continue;
      }
      const existing = await this.findCampaignByName(actor.orgId, campaign.name);
      if (existing) {
        result.idMap[campaign.id] = existing.id;
        result.skipped++;
        continue;
      }
      const created = await this.createCampaign({
        name: campaign.name,
        brief: campaign.brief,
        segmentId,
        channelId,
        cadenceRules: campaign.cadenceRules,
        ctaUrl: campaign.ctaUrl,
        enabled: false,
        unsubscribeRequired: campaign.unsubscribeRequired,
      });
      result.idMap[campaign.id] = created.id;
      result.created++;
      result.warnings.push(
        `campaign "${campaign.name}" imported disabled — re-enable it once the channel credentials are re-entered on this server`,
      );
    }

    for (const proposal of data.proposals) {
      const campaignId = resolveId(result.idMap, proposal.campaignId);
      const contactId = resolveId(result.idMap, proposal.contactId);
      if (!campaignId || !contactId) {
        result.warnings.push(
          `proposal ${proposal.id} skipped: its campaign or contact was not part of this import`,
        );
        result.skipped++;
        continue;
      }
      const existing = await this.findProposalByKey(campaignId, contactId, proposal.kind);
      if (existing) {
        result.idMap[proposal.id] = existing.id;
        result.skipped++;
        continue;
      }
      const conversationId = resolveId(result.idMap, proposal.conversationId) ?? null;
      const [row] = await ctx.db
        .insert(schema.outreachProposals)
        .values({
          orgId: actor.orgId,
          campaignId,
          contactId,
          conversationId,
          kind: proposal.kind,
          draftSubject: proposal.draftSubject,
          draftBody: proposal.draftBody,
          evidence: proposal.evidence,
          proposedSendAt: proposal.proposedSendAt ? new Date(proposal.proposedSendAt) : null,
          status: proposal.status,
          proposedByActorType: actor.type,
          proposedByActorId: actor.id,
        })
        .returning();
      result.idMap[proposal.id] = row!.id;
      result.created++;
    }
    return result;
  }

  private async findCampaignByName(
    orgId: string,
    name: string,
  ): Promise<{ id: string } | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.outreachCampaigns.id })
      .from(schema.outreachCampaigns)
      .where(and(eq(schema.outreachCampaigns.orgId, orgId), eq(schema.outreachCampaigns.name, name)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findProposalByKey(
    campaignId: string,
    contactId: string,
    kind: ProposalKind,
  ): Promise<{ id: string } | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.outreachProposals.id })
      .from(schema.outreachProposals)
      .where(
        and(
          eq(schema.outreachProposals.campaignId, campaignId),
          eq(schema.outreachProposals.contactId, contactId),
          eq(schema.outreachProposals.kind, kind),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
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
  return `${base}/v1/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
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
