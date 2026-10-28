import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { JOURNEY_CHAT_MAX_CHARS, canSendWithoutReview } from '@getmunin/types';
import { ConvService } from '../conv/conv.service.ts';
import { CrmService } from '../crm/crm.service.ts';
import { EmailService } from '../conv/email/email.service.ts';
import { findOrCreateContactByPhone } from '../conv/contact-by-phone.ts';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import {
  OutreachService,
  SMS_DRAFT_MAX_CHARS,
  buildUnsubscribeUrl,
  composeSmsOutreachBody,
  personalizeSms,
  type ProposalDto,
  type ProposalKindHandler,
  type ProposalSender,
} from './outreach.service.ts';
import { OutreachInvalidError } from './outreach-errors.ts';
import { assertEligible } from './eligibility.ts';
import { emailTemplateHash } from './email-template-hash.ts';
import { checkSendPolicy, type SendDecision, type SendPolicy } from './send-policy.ts';
import {
  parseJourneyDelivery,
  type JourneyDelivery,
  type JourneyDeliveryChannel,
} from './journey-delivery.ts';

export type JourneyOutboxHost = Pick<
  OutreachService,
  | 'registerKindHandler'
  | 'getProposal'
  | 'getCampaign'
  | 'loadOutreachChannel'
  | 'approveAutomatically'
  | 'recordScheduledSendFailure'
  | 'deliverVoiceCall'
>;

type JourneyConversations = Pick<ConvService, 'sendMessage' | 'createConversation' | 'startWidgetConversation'>;

export const TEMPLATE_HOLD_RECHECK_MS = 60 * 60_000;
export const PAUSE_HOLD_RECHECK_MS = 15 * 60_000;

export function journeyTemplateAlertSubject(journeyId: string): string {
  return `${journeyId}:email_template`;
}

export interface JourneyMessageDraft {
  campaignId: string;
  channel: JourneyDeliveryChannel;
  channelId: string | null;
  contactId: string;
  enrollmentId: string;
  stepRunId: string;
  subject: string | null;
  body: string;
  format: 'markdown' | 'mjml';
  templateId?: string;
  templateHash?: string | null;
  preheader?: string;
  policy: SendPolicy;
  auto: boolean;
  evidence: Record<string, unknown>;
}

@Injectable()
export class JourneyOutboxService implements ProposalKindHandler {
  constructor(
    @Inject(OutreachService) private readonly outreach: JourneyOutboxHost,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(ConvService) private readonly conv: JourneyConversations,
    @Inject(CrmService) private readonly crm: Pick<CrmService, 'getContact'>,
    @Inject(EmailService) private readonly email: Pick<EmailService, 'findOrCreateContactByEmail'>,
    @Inject(AlertsService) private readonly alerts: Pick<AlertsService, 'openAlert'>,
  ) {
    outreach.registerKindHandler('journey', this);
  }

  async propose(input: JourneyMessageDraft, opts: { publicBaseUrl: string }): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const p = schema.outreachProposals;
    const [existing] = await ctx.db
      .select({ id: p.id })
      .from(p)
      .where(and(eq(p.journeyStepRunId, input.stepRunId), eq(p.contactId, input.contactId)))
      .limit(1);
    if (existing) return this.outreach.getProposal(existing.id);
    await this.assertDraftable(input);

    const delivery: JourneyDelivery = {
      channel: input.channel,
      format: input.format,
      templateId: input.templateId ?? null,
      templateHash: input.templateHash ?? null,
      preheader: input.preheader ?? null,
      policy: input.policy,
      auto: input.auto,
    };
    const [row] = await ctx.db
      .insert(p)
      .values({
        orgId: actor.orgId,
        campaignId: input.campaignId,
        channelId: input.channel === 'email' ? null : input.channelId,
        contactId: input.contactId,
        kind: 'journey',
        journeyEnrollmentId: input.enrollmentId,
        journeyStepRunId: input.stepRunId,
        journeyDelivery: delivery,
        draftSubject: input.subject,
        draftBody: input.body,
        evidence: input.evidence,
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
        kind: 'journey',
        channel: input.channel,
        journeyEnrollmentId: input.enrollmentId,
        ...(input.auto ? { autoApproved: true } : {}),
      },
    });
    const proposal = await this.outreach.getProposal(row!.id);
    if (!input.auto) return proposal;

    const now = new Date();
    const decision = await checkSendPolicy({ contactId: proposal.contactId, policy: delivery.policy, now });
    if (decision.decision === 'skip') {
      return this.outreach.recordScheduledSendFailure(proposal.id, `journey ${input.channel} blocked: ${decision.reason}`, {
        terminal: true,
      });
    }
    let sendAt = decision.decision === 'defer' ? decision.until : null;
    if (await this.templateDrifted(delivery)) {
      await this.alertTemplateChanged(proposal);
      const held = new Date(now.getTime() + TEMPLATE_HOLD_RECHECK_MS);
      if (!sendAt || sendAt < held) sendAt = held;
    }
    return this.outreach.approveAutomatically(proposal, { sendAt, publicBaseUrl: opts.publicBaseUrl });
  }

  allowsAutomaticApproval(proposal: ProposalDto): boolean {
    const delivery = parseJourneyDelivery(proposal.id, proposal.journeyDelivery);
    return delivery.auto && canSendWithoutReview(delivery.channel, delivery.policy.class);
  }

  async withdrawRun(enrollmentId: string, reason: string): Promise<number> {
    const ctx = getCurrentContext();
    const p = schema.outreachProposals;
    const rows = await ctx.db
      .update(p)
      .set({ status: 'withdrawn', withdrawReason: reason, scheduledSendAt: null, updatedAt: new Date() })
      .where(and(eq(p.journeyEnrollmentId, enrollmentId), inArray(p.status, ['pending', 'approved'])))
      .returning({ id: p.id, campaignId: p.campaignId, contactId: p.contactId });
    for (const row of rows) {
      await this.webhooks.emit({
        type: 'outreach.proposal.withdrawn',
        payload: { proposalId: row.id, campaignId: row.campaignId, contactId: row.contactId, kind: 'journey', reason },
      });
    }
    return rows.length;
  }

  async gate(proposal: ProposalDto, at: Date, stage: 'approve' | 'scheduled'): Promise<SendDecision> {
    const held = await this.runHold(proposal);
    if (held) return { decision: 'defer', until: new Date(at.getTime() + PAUSE_HOLD_RECHECK_MS), reason: held };
    const delivery = parseJourneyDelivery(proposal.id, proposal.journeyDelivery);
    if (stage === 'scheduled' && proposal.decidedByActorType !== 'user' && (await this.templateDrifted(delivery))) {
      await this.alertTemplateChanged(proposal);
      return { decision: 'defer', until: new Date(at.getTime() + TEMPLATE_HOLD_RECHECK_MS), reason: 'template_changed' };
    }
    const decision = await checkSendPolicy({ contactId: proposal.contactId, policy: delivery.policy, now: at });
    if (decision.decision === 'skip') {
      throw new OutreachInvalidError(
        `this journey email cannot be sent: ${decision.reason}`,
        'outreach_journey_blocked',
      );
    }
    return decision;
  }

  deliver(proposal: ProposalDto, sender: ProposalSender, publicBaseUrl: string): Promise<ProposalDto> {
    const delivery = parseJourneyDelivery(proposal.id, proposal.journeyDelivery);
    if (delivery.channel === 'sms') return this.deliverSms(proposal, delivery, sender);
    if (delivery.channel === 'voice') return this.deliverCall(proposal, delivery);
    if (delivery.channel === 'chat') return this.deliverChat(proposal, delivery, sender);
    return this.deliverEmail(proposal, delivery, sender, publicBaseUrl);
  }

  private async assertDraftable(input: JourneyMessageDraft): Promise<void> {
    if (input.channel === 'email') return;
    if (input.channel === 'chat') {
      if (!input.channelId) throw new OutreachInvalidError('a journey chat step needs a chat widget channel');
      const ctx = getCurrentContext();
      const [channel] = await ctx.db
        .select({ type: schema.convChannels.type })
        .from(schema.convChannels)
        .where(eq(schema.convChannels.id, input.channelId))
        .limit(1);
      if (channel?.type !== 'chat') {
        throw new OutreachInvalidError(`channel ${input.channelId} is not a chat widget channel`);
      }
      if (input.body.length > JOURNEY_CHAT_MAX_CHARS) {
        throw new OutreachInvalidError(`the chat message is ${input.body.length} characters; the limit is ${JOURNEY_CHAT_MAX_CHARS}`);
      }
      return;
    }
    if (input.auto && !canSendWithoutReview(input.channel, input.policy.class)) {
      throw new OutreachInvalidError(
        input.channel === 'sms'
          ? 'journey marketing SMS is approved by a person; only transactional SMS can run automatically'
          : `journey ${input.channel} steps are always approved by a person; they cannot run automatically`,
      );
    }
    if (!input.channelId) throw new OutreachInvalidError(`a journey ${input.channel} step needs a ${input.channel} channel`);
    const channel = await this.outreach.loadOutreachChannel(input.channelId);
    if (channel.type !== input.channel) {
      throw new OutreachInvalidError(`channel ${input.channelId} is ${channel.type}, not ${input.channel}`);
    }
    if (input.channel === 'sms' && input.body.length > SMS_DRAFT_MAX_CHARS) {
      throw new OutreachInvalidError(`SMS text is ${input.body.length} characters; the limit is ${SMS_DRAFT_MAX_CHARS}`);
    }
  }

  private async runHold(proposal: ProposalDto): Promise<'journey_paused' | 'step_paused' | null> {
    const ctx = getCurrentContext();
    const [run] = proposal.journeyEnrollmentId
      ? await ctx.db
          .select({
            state: schema.journeyEnrollments.state,
            journeyStatus: schema.journeys.status,
            pausedNodes: schema.journeys.pausedNodes,
          })
          .from(schema.journeyEnrollments)
          .innerJoin(schema.journeys, eq(schema.journeys.id, schema.journeyEnrollments.journeyId))
          .where(eq(schema.journeyEnrollments.id, proposal.journeyEnrollmentId))
          .limit(1)
      : [];
    if (!run || !['active', 'waiting'].includes(run.state) || !['live', 'paused'].includes(run.journeyStatus)) {
      throw new OutreachInvalidError(
        `proposal ${proposal.id} belongs to a journey run that is no longer running, so it cannot be sent`,
        'outreach_journey_ended',
      );
    }
    if (run.journeyStatus === 'paused') return 'journey_paused';
    if (!proposal.journeyStepRunId) return null;
    const [step] = await ctx.db
      .select({ nodeId: schema.journeyStepRuns.nodeId })
      .from(schema.journeyStepRuns)
      .where(eq(schema.journeyStepRuns.id, proposal.journeyStepRunId))
      .limit(1);
    return step && run.pausedNodes[step.nodeId] ? 'step_paused' : null;
  }

  private async templateDrifted(delivery: JourneyDelivery): Promise<boolean> {
    if (delivery.channel !== 'email') return false;
    if (delivery.templateHash === null) return true;
    return (await emailTemplateHash(delivery.templateId)) !== delivery.templateHash;
  }

  private async alertTemplateChanged(proposal: ProposalDto): Promise<void> {
    if (!proposal.journeyEnrollmentId) return;
    const ctx = getCurrentContext();
    const [journey] = await ctx.db
      .select({ id: schema.journeys.id, name: schema.journeys.name })
      .from(schema.journeyEnrollments)
      .innerJoin(schema.journeys, eq(schema.journeys.id, schema.journeyEnrollments.journeyId))
      .where(eq(schema.journeyEnrollments.id, proposal.journeyEnrollmentId))
      .limit(1);
    if (!journey) return;
    await this.alerts.openAlert({
      source: 'journeys',
      subjectId: journeyTemplateAlertSubject(journey.id),
      severity: 'warning',
      title: `Journey "${journey.name}" is holding emails: an email template changed`,
      detail:
        'A step that sends without review uses an email template that changed after the journey was published. ' +
        'Its emails wait until a person re-approves the journey with the new template.',
      metadata: { journeyId: journey.id, kind: 'template_changed' },
      ctaHref: `/dashboard/journeys/${journey.id}?templates=review`,
    });
  }

  private async deliverEmail(
    proposal: ProposalDto,
    delivery: JourneyDelivery,
    sender: ProposalSender,
    publicBaseUrl: string,
  ): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const campaign = await this.outreach.getCampaign(proposal.campaignId);
    const channel = await this.outreach.loadOutreachChannel(campaign.channelId);
    if (channel.type !== 'email') {
      throw new OutreachInvalidError(
        `journey emails need an email channel; campaign ${campaign.id} uses ${channel.type}`,
      );
    }
    const contact = await this.crm.getContact(proposal.contactId);
    assertEligible(contact, { class: delivery.policy.class, channelType: 'email' });
    if (!contact.email) {
      throw new OutreachInvalidError(`contact ${contact.id} has no email — cannot send`);
    }
    const marketing = delivery.policy.class === 'marketing';

    const unsubscribeUrl = buildUnsubscribeUrl({
      publicBaseUrl,
      orgId: actor.orgId,
      contactId: contact.id,
      campaignId: campaign.id,
    });
    const { renderEmail, BUILT_IN_EMAIL_TEMPLATE } = await import('./email-template-render.ts');
    const mjml = await this.templateMjml(delivery.templateId, BUILT_IN_EMAIL_TEMPLATE);
    const [org] = await ctx.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, actor.orgId))
      .limit(1);
    const rendered = await renderEmail(
      mjml,
      { format: delivery.format, body: proposal.draftBody },
      {
        subject: proposal.draftSubject,
        preheader: delivery.preheader,
        orgName: org?.name ?? null,
        name: contact.name,
        unsubscribeUrl,
      },
    );
    const messageMetadata = {
      journeyStepRunId: proposal.journeyStepRunId,
      ...(marketing ? { listUnsubscribeUrl: unsubscribeUrl } : {}),
    };
    const approvedByPerson = proposal.decidedByActorType === 'user' ? proposal.id : undefined;

    const threadId = proposal.journeyEnrollmentId
      ? await this.emailThread(proposal.journeyEnrollmentId, proposal.contactId)
      : null;
    let conversationId: string;
    let messageId: string | null;
    if (threadId) {
      const sent = await this.conv.sendMessage({
        conversationId: threadId,
        body: rendered.text,
        bodyHtml: rendered.html,
        messageMetadata,
        approvedOutreachProposalId: approvedByPerson,
        authorType: 'agent',
        authorId: sender.id,
      });
      conversationId = threadId;
      messageId = sent.id;
    } else {
      const convContact = await ctx.db.transaction(async (tx) =>
        this.email.findOrCreateContactByEmail(tx, actor.orgId, contact.email!, contact.name ?? undefined),
      );
      const conversation = await this.conv.createConversation({
        channelId: campaign.channelId,
        body: rendered.text,
        bodyHtml: rendered.html,
        subject: proposal.draftSubject ?? undefined,
        contactId: convContact.id,
        endUserId: contact.endUserId ?? undefined,
        outreachCampaignId: campaign.id,
        messageMetadata,
        approvedOutreachProposalId: approvedByPerson,
        agentMode: 'draft_only',
        authorType: 'agent',
        authorId: sender.id,
      });
      conversationId = conversation.id;
      messageId = conversation.messages[0]?.id ?? null;
    }
    return this.markSent(proposal, contact.id, conversationId, messageId, {
      journeyEnrollmentId: proposal.journeyEnrollmentId,
      ...(delivery.auto ? { autoApproved: true } : {}),
    });
  }

  private async deliverSms(
    proposal: ProposalDto,
    delivery: JourneyDelivery,
    sender: ProposalSender,
  ): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (proposal.decidedByActorType !== 'user' && !(delivery.auto && canSendWithoutReview('sms', delivery.policy.class))) {
      throw new OutreachInvalidError('journey marketing SMS is sent only after a person approves it');
    }
    const channelId = proposal.delivery?.channelId;
    if (!channelId || proposal.delivery?.channelType !== 'sms') {
      throw new OutreachInvalidError(`proposal ${proposal.id} has no SMS channel to send from`);
    }
    const contact = await this.crm.getContact(proposal.contactId);
    assertEligible(contact, { class: delivery.policy.class, channelType: 'sms' });
    if (!contact.phone) throw new OutreachInvalidError(`contact ${contact.id} has no phone — cannot send`);

    const body = composeSmsOutreachBody({
      draftBody: personalizeSms(proposal.draftBody, contact.name),
      ctaUrl: null,
      unsubscribeRequired: delivery.policy.class === 'marketing',
    });
    const messageMetadata = { journeyStepRunId: proposal.journeyStepRunId };
    const threadId = await this.channelThread(proposal.contactId, channelId);
    let conversationId: string;
    let messageId: string | null;
    if (threadId) {
      const sent = await this.conv.sendMessage({
        conversationId: threadId,
        body,
        messageMetadata,
        approvedOutreachProposalId: proposal.id,
        authorType: 'agent',
        authorId: sender.id,
      });
      conversationId = threadId;
      messageId = sent.id;
    } else {
      const convContact = await ctx.db.transaction(async (tx) => {
        const found = await findOrCreateContactByPhone(
          tx,
          actor.orgId,
          contact.phone!,
          contact.name ?? undefined,
          'outreach-sms',
        );
        if (!found) throw new OutreachInvalidError(`could not resolve a contact for ${contact.phone}`);
        return found;
      });
      const conversation = await this.conv.createConversation({
        channelId,
        body,
        contactId: convContact.id,
        endUserId: contact.endUserId ?? undefined,
        outreachCampaignId: proposal.campaignId,
        messageMetadata,
        approvedOutreachProposalId: proposal.id,
        agentMode: 'draft_only',
        authorType: 'agent',
        authorId: sender.id,
      });
      conversationId = conversation.id;
      messageId = conversation.messages[0]?.id ?? null;
    }
    return this.markSent(proposal, contact.id, conversationId, messageId, {
      channel: 'sms',
      journeyEnrollmentId: proposal.journeyEnrollmentId,
    });
  }

  private async deliverCall(proposal: ProposalDto, delivery: JourneyDelivery): Promise<ProposalDto> {
    if (proposal.decidedByActorType !== 'user') {
      throw new OutreachInvalidError('a journey call is placed only after a person approves it');
    }
    const channelId = proposal.delivery?.channelId;
    if (!channelId || proposal.delivery?.channelType !== 'voice') {
      throw new OutreachInvalidError(`proposal ${proposal.id} has no voice channel to call from`);
    }
    const contact = await this.crm.getContact(proposal.contactId);
    assertEligible(contact, { class: delivery.policy.class, channelType: 'voice' });
    return this.outreach.deliverVoiceCall(proposal, contact, channelId, {
      kind: 'journey',
      channel: 'voice',
      journeyEnrollmentId: proposal.journeyEnrollmentId,
    });
  }

  private async deliverChat(
    proposal: ProposalDto,
    delivery: JourneyDelivery,
    sender: ProposalSender,
  ): Promise<ProposalDto> {
    const channelId = proposal.delivery?.channelId;
    if (!channelId || proposal.delivery?.channelType !== 'chat') {
      throw new OutreachInvalidError(`proposal ${proposal.id} has no chat channel to write in`);
    }
    const contact = await this.crm.getContact(proposal.contactId);
    assertEligible(contact, { class: delivery.policy.class, channelType: 'chat' });
    if (!contact.endUserId) {
      throw new OutreachInvalidError(`contact ${contact.id} has no signed-in widget identity to write to`);
    }

    const body = personalizeSms(proposal.draftBody, contact.name);
    const messageMetadata = { journeyStepRunId: proposal.journeyStepRunId };
    const approvedOutreachProposalId = proposal.decidedByActorType === 'user' ? proposal.id : undefined;
    const threadId = await this.channelThread(proposal.contactId, channelId);
    let conversationId: string;
    let messageId: string | null;
    if (threadId) {
      const sent = await this.conv.sendMessage({
        conversationId: threadId,
        body,
        messageMetadata,
        approvedOutreachProposalId,
        authorType: 'agent',
        authorId: sender.id,
      });
      conversationId = threadId;
      messageId = sent.id;
    } else {
      const conversation = await this.conv.startWidgetConversation({
        channelId,
        endUserId: contact.endUserId,
        body,
        outreachCampaignId: proposal.campaignId,
        approvedOutreachProposalId,
        messageMetadata,
        authorType: 'agent',
        authorId: sender.id,
      });
      conversationId = conversation.id;
      messageId = conversation.messages[0]?.id ?? null;
    }
    return this.markSent(proposal, contact.id, conversationId, messageId, {
      channel: 'chat',
      journeyEnrollmentId: proposal.journeyEnrollmentId,
    });
  }

  private async markSent(
    proposal: ProposalDto,
    contactId: string,
    conversationId: string,
    messageId: string | null,
    sentPayload: Record<string, unknown>,
  ): Promise<ProposalDto> {
    const ctx = getCurrentContext();
    const now = new Date();
    await ctx.db
      .update(schema.outreachProposals)
      .set({ status: 'sent', conversationId, sentMessageId: messageId, sentAt: now, updatedAt: now })
      .where(eq(schema.outreachProposals.id, proposal.id));
    await ctx.db
      .update(schema.crmContacts)
      .set({ lastContactedAt: now, updatedAt: now })
      .where(eq(schema.crmContacts.id, contactId));
    await this.webhooks.emit({
      type: 'outreach.proposal.sent',
      payload: {
        proposalId: proposal.id,
        campaignId: proposal.campaignId,
        contactId,
        conversationId,
        messageId,
        kind: 'journey',
        ...sentPayload,
      },
    });
    return this.outreach.getProposal(proposal.id);
  }

  private async channelThread(contactId: string, channelId: string): Promise<string | null> {
    const ctx = getCurrentContext();
    const p = schema.outreachProposals;
    const [row] = await ctx.db
      .select({ conversationId: p.conversationId })
      .from(p)
      .where(
        and(
          eq(p.contactId, contactId),
          eq(p.kind, 'journey'),
          eq(p.channelId, channelId),
          eq(p.status, 'sent'),
          isNotNull(p.conversationId),
        ),
      )
      .orderBy(desc(p.sentAt))
      .limit(1);
    return row?.conversationId ?? null;
  }

  private async emailThread(enrollmentId: string, contactId: string): Promise<string | null> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ conversationId: schema.journeyEnrollments.conversationId, contactId: schema.journeyEnrollments.contactId })
      .from(schema.journeyEnrollments)
      .where(eq(schema.journeyEnrollments.id, enrollmentId))
      .limit(1);
    if (row?.contactId) return row.conversationId ?? null;
    const p = schema.outreachProposals;
    const [sent] = await ctx.db
      .select({ conversationId: p.conversationId })
      .from(p)
      .where(
        and(
          eq(p.journeyEnrollmentId, enrollmentId),
          eq(p.contactId, contactId),
          isNull(p.channelId),
          eq(p.status, 'sent'),
          isNotNull(p.conversationId),
        ),
      )
      .orderBy(desc(p.sentAt))
      .limit(1);
    return sent?.conversationId ?? null;
  }

  private async templateMjml(templateId: string | null, builtIn: string): Promise<string> {
    const ctx = getCurrentContext();
    const t = schema.outreachEmailTemplates;
    const [row] = await ctx.db
      .select({ mjml: t.mjml })
      .from(t)
      .where(templateId ? eq(t.id, templateId) : eq(t.isDefault, true))
      .limit(1);
    if (templateId && !row) throw new OutreachInvalidError(`email template ${templateId} no longer exists`);
    return row?.mjml ?? builtIn;
  }
}
