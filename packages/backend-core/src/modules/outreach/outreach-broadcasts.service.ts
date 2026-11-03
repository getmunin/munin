import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@getmunin/db';
import {
  getCurrentContext,
  readApiBaseUrl,
  signUnsubscribeToken,
  WebhookDispatcher,
} from '@getmunin/core';
import { stripTrailingSlashes } from '@getmunin/types';
import { EmailAdapter, type BulkEmail, type BulkEmailResult } from '../conv/email/email-adapter.ts';
import type { ChannelRow } from '../conv/channels/adapter.ts';
import { normalizeAddress } from '../crm/address-deliverability.ts';
import { segmentMatchFilters } from '../crm/segment-filter.ts';
import {
  BUILT_IN_EMAIL_TEMPLATE,
  compileEmail,
  personalizeEmail,
  type EmailContent,
  type EmailContentFormat,
} from './email-template-render.ts';
import { OutreachInvalidError } from './outreach.service.ts';
import { checkSendPolicyBatch } from './send-policy.ts';
import {
  decidedBefore,
  toDecidedActor,
  type DecidedQuery,
  type ReviewDecision,
  type ReviewDecisionOutcome,
} from '../../common/review-decision.ts';

export const BROADCAST_STATUSES = [
  'pending',
  'approved',
  'sending',
  'sent',
  'cancelled',
  'dismissed',
  'failed',
] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export const BROADCAST_RECIPIENT_STATUSES = ['queued', 'sending', 'sent', 'skipped', 'failed'] as const;
export type BroadcastRecipientStatus = (typeof BROADCAST_RECIPIENT_STATUSES)[number];

export const AUDIENCE_EXCLUSION_REASONS = [
  'unsubscribed',
  'do_not_contact',
  'no_lawful_basis',
  'no_email',
  'undeliverable',
  'duplicate_address',
] as const;
export type AudienceExclusionReason = (typeof AUDIENCE_EXCLUSION_REASONS)[number];

export const BROADCAST_WORKER_ACTOR_ID = 'outreach-broadcast-worker';
export const MAX_BROADCAST_SEND_ATTEMPTS = 3;
export const STALE_SENDING_MINUTES = 15;

const DEFAULT_MAX_AUDIENCE = 50_000;
const RECIPIENT_INSERT_CHUNK = 1_000;
const AUDIENCE_SAMPLE_SIZE = 5;
const TEST_SEND_CONTACT_ID = 'test-send';

export interface BulkEmailSender {
  sendBulk(channel: ChannelRow, messages: readonly BulkEmail[]): Promise<BulkEmailResult[]>;
}

export interface AudienceMember {
  contactId: string;
  name: string | null;
  address: string;
}

export interface AudiencePreview {
  eligible: number;
  excluded: Record<AudienceExclusionReason, number>;
  sample: AudienceMember[];
  frozen: boolean;
}

export interface BroadcastCounts {
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
  replied: number;
  unsubscribed: number;
  bounced: number;
}

export interface BroadcastSummaryDto {
  id: string;
  name: string;
  status: BroadcastStatus;
  segmentId: string;
  channelId: string;
  emailTemplateId: string | null;
  subject: string;
  scheduledSendAt: string | null;
  approvedAudienceCount: number | null;
  counts: BroadcastCounts;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

export interface BroadcastPreview {
  html: string;
  text: string;
  htmlBytes: number;
  warnings: string[];
  recipient: { contactId: string | null; name: string | null; address: string | null };
}

export interface BroadcastDto extends BroadcastSummaryDto {
  preheader: string | null;
  content: EmailContent;
  maxPerHour: number | null;
  contentFingerprint: string;
  audience: AudiencePreview;
  preview: BroadcastPreview;
  proposedByActorType: string;
  proposedByActorId: string;
  decidedByActorType: string | null;
  decidedByActorId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  dismissReason: string | null;
  cancelReason: string | null;
  failureReason: string | null;
}

export interface BroadcastRecipientDto {
  id: string;
  contactId: string | null;
  address: string;
  status: BroadcastRecipientStatus;
  skipReason: string | null;
  failureReason: string | null;
  attempts: number;
  sentAt: string | null;
  repliedAt: string | null;
  unsubscribedAt: string | null;
  conversationId: string | null;
}

export interface ClaimedBatch {
  broadcastId: string;
  channel: ChannelRow | null;
  pausedReason: string | null;
  messages: BulkEmail[];
  skipped: number;
}

type BroadcastRow = typeof schema.outreachBroadcasts.$inferSelect;

interface ContentInput {
  format: EmailContentFormat;
  body: string;
}

@Injectable()
export class OutreachBroadcastsService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(EmailAdapter) private readonly mail: BulkEmailSender,
  ) {}

  async createBroadcast(input: {
    name: string;
    segmentId: string;
    channelId: string;
    emailTemplateId?: string | null;
    subject: string;
    preheader?: string | null;
    content: ContentInput;
    scheduledSendAt?: string | null;
    maxPerHour?: number | null;
  }): Promise<BroadcastDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const name = requireText(input.name, 'name');
    const subject = requireText(input.subject, 'subject');
    await this.assertNameFree(name);
    await this.assertSegmentExists(input.segmentId);
    await this.loadEmailChannel(input.channelId);
    const template = await this.resolveTemplate(input.emailTemplateId ?? null);
    await compileEmail(template.mjml, input.content);
    const [row] = await ctx.db
      .insert(schema.outreachBroadcasts)
      .values({
        orgId: actor.orgId,
        name,
        segmentId: input.segmentId,
        channelId: input.channelId,
        emailTemplateId: input.emailTemplateId ?? null,
        subject,
        preheader: input.preheader?.trim() || null,
        contentFormat: input.content.format,
        body: input.content.body,
        scheduledSendAt: parseSendAt(input.scheduledSendAt),
        maxPerHour: input.maxPerHour ?? null,
        proposedByActorType: actor.type,
        proposedByActorId: actor.id,
      })
      .returning();
    await this.webhooks.emit({
      type: 'outreach.broadcast.created',
      payload: { broadcastId: row!.id, segmentId: row!.segmentId, channelId: row!.channelId },
    });
    return this.getBroadcast(row!.id);
  }

  async updateBroadcast(input: {
    id: string;
    name?: string;
    segmentId?: string;
    channelId?: string;
    emailTemplateId?: string | null;
    subject?: string;
    preheader?: string | null;
    content?: ContentInput;
    scheduledSendAt?: string | null;
    maxPerHour?: number | null;
  }): Promise<BroadcastDto> {
    const ctx = getCurrentContext();
    const existing = await this.loadBroadcast(input.id);
    assertStatus(existing, ['pending'], 'edited');
    const name = input.name === undefined ? undefined : requireText(input.name, 'name');
    const subject = input.subject === undefined ? undefined : requireText(input.subject, 'subject');
    if (name !== undefined && name !== existing.name) await this.assertNameFree(name, existing.id);
    if (input.segmentId !== undefined) await this.assertSegmentExists(input.segmentId);
    if (input.channelId !== undefined) await this.loadEmailChannel(input.channelId);
    const templateId =
      input.emailTemplateId === undefined ? existing.emailTemplateId : input.emailTemplateId;
    const template = await this.resolveTemplate(templateId);
    const content = input.content ?? contentOf(existing);
    await compileEmail(template.mjml, content);
    await ctx.db
      .update(schema.outreachBroadcasts)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(input.segmentId !== undefined ? { segmentId: input.segmentId } : {}),
        ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
        ...(input.emailTemplateId !== undefined ? { emailTemplateId: input.emailTemplateId } : {}),
        ...(input.preheader !== undefined ? { preheader: input.preheader?.trim() || null } : {}),
        ...(input.content !== undefined
          ? { contentFormat: input.content.format, body: input.content.body }
          : {}),
        ...(input.scheduledSendAt !== undefined
          ? { scheduledSendAt: parseSendAt(input.scheduledSendAt) }
          : {}),
        ...(input.maxPerHour !== undefined ? { maxPerHour: input.maxPerHour } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.outreachBroadcasts.id, existing.id));
    return this.getBroadcast(existing.id);
  }

  async getBroadcast(id: string): Promise<BroadcastDto> {
    const row = await this.loadBroadcast(id);
    const counts = (await this.countsFor([row.id])).get(row.id) ?? emptyCounts();
    if (row.status === 'pending') {
      const template = await this.resolveTemplate(row.emailTemplateId);
      const compiled = await compileEmail(template.mjml, contentOf(row));
      const audience = await this.computeAudience(row.segmentId);
      const sample = audience.members[0] ?? null;
      return toDto(row, counts, {
        fingerprint: broadcastFingerprint(compiled.html, row, audience.members.length),
        audience: audience.preview,
        preview: await this.renderPreview(row, compiled.html, compiled.warnings, sample),
      });
    }
    const html = row.approvedHtml ?? '';
    const sample = await this.firstRecipient(row.id);
    return toDto(row, counts, {
      fingerprint: row.approvedFingerprint ?? '',
      audience: frozenAudience(row, counts),
      preview: html
        ? await this.renderPreview(row, html, [], sample)
        : { html: '', text: '', htmlBytes: 0, warnings: [], recipient: emptyRecipient() },
    });
  }

  async listBroadcasts(input: {
    status?: BroadcastStatus;
    limit?: number;
  }): Promise<BroadcastSummaryDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.outreachBroadcasts)
      .where(input.status ? eq(schema.outreachBroadcasts.status, input.status) : undefined)
      .orderBy(desc(schema.outreachBroadcasts.updatedAt))
      .limit(clampLimit(input.limit, 50, 200));
    const counts = await this.countsFor(rows.map((r) => r.id));
    return rows.map((r) => toSummary(r, counts.get(r.id) ?? emptyCounts()));
  }

  async listDecided(input: DecidedQuery): Promise<ReviewDecision<BroadcastSummaryDto>[]> {
    const ctx = getCurrentContext();
    const b = schema.outreachBroadcasts;
    const rows = await ctx.db
      .select()
      .from(b)
      .where(
        and(
          notInArray(b.status, ['pending', 'approved']),
          isNotNull(b.decidedAt),
          decidedBefore(b.decidedAt, b.id, input.cursor),
        ),
      )
      .orderBy(desc(b.decidedAt), desc(b.id))
      .limit(clampLimit(input.limit, 50, 200));
    const counts = await this.countsFor(rows.map((r) => r.id));
    const userIds = rows
      .filter((r) => r.decidedByActorType === 'user' && r.decidedByActorId)
      .map((r) => r.decidedByActorId!);
    const names = new Map(
      (userIds.length
        ? await ctx.db
            .select({ id: schema.users.id, name: schema.users.name })
            .from(schema.users)
            .where(inArray(schema.users.id, userIds))
        : []
      ).flatMap((u) => (u.name ? [[u.id, u.name] as const] : [])),
    );
    return rows.map((r) => ({
      id: r.id,
      decidedAt: r.decidedAt!.toISOString(),
      outcome: decisionOutcome(r.status),
      reason: r.dismissReason ?? r.cancelReason ?? r.failureReason ?? null,
      decidedBy: toDecidedActor(
        r.decidedByActorType,
        r.decidedByActorId,
        names.get(r.decidedByActorId ?? '') ?? null,
      ),
      producedRef: null,
      raw: toSummary(r, counts.get(r.id) ?? emptyCounts()),
    }));
  }

  async listRecipients(input: {
    broadcastId: string;
    status?: BroadcastRecipientStatus;
    limit?: number;
    after?: string;
  }): Promise<{ items: BroadcastRecipientDto[]; nextCursor: string | null }> {
    const ctx = getCurrentContext();
    const broadcast = await this.loadBroadcast(input.broadcastId);
    const limit = clampLimit(input.limit, 100, 500);
    const r = schema.outreachBroadcastRecipients;
    const rows = await ctx.db
      .select()
      .from(r)
      .where(
        and(
          eq(r.broadcastId, broadcast.id),
          input.status ? eq(r.status, input.status) : undefined,
          input.after ? gt(r.id, input.after) : undefined,
        ),
      )
      .orderBy(asc(r.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: page.map(toRecipientDto),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  async approveBroadcast(input: {
    id: string;
    fingerprint: string;
    sendAt?: string | null;
  }): Promise<BroadcastDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (actor.type !== 'user') {
      throw new OutreachInvalidError(
        `broadcasts are approved by a signed-in person in the Munin dashboard, not by an agent or API key — this caller is ${actor.type}`,
      );
    }
    const row = await this.loadBroadcast(input.id);
    assertStatus(row, ['pending'], 'approved');
    await this.loadEmailChannel(row.channelId);
    const template = await this.resolveTemplate(row.emailTemplateId);
    const compiled = await compileEmail(template.mjml, contentOf(row));
    const audience = await this.computeAudience(row.segmentId);
    const fingerprint = broadcastFingerprint(compiled.html, row, audience.members.length);
    if (fingerprint !== input.fingerprint) {
      throw new ConflictException({
        message: `outreach_broadcast_changed: broadcast ${row.id} changed since it was read (its content, template or audience size is different now); read it again and approve what it says now`,
        code: 'outreach_broadcast_changed',
      });
    }
    if (audience.members.length === 0) {
      throw new OutreachInvalidError(
        `nobody in segment ${row.segmentId} can receive broadcast ${row.id}; check the audience exclusions`,
        'outreach_broadcast_empty_audience',
      );
    }
    const maxAudience = readMaxAudience();
    if (audience.members.length > maxAudience) {
      throw new OutreachInvalidError(
        `broadcast ${row.id} would go to ${audience.members.length} people; this deployment allows at most ${maxAudience} per broadcast`,
      );
    }

    const now = new Date();
    const requested = input.sendAt !== undefined ? parseSendAt(input.sendAt) : row.scheduledSendAt;
    const scheduledSendAt = requested && requested > now ? requested : now;

    for (let i = 0; i < audience.members.length; i += RECIPIENT_INSERT_CHUNK) {
      await ctx.db.insert(schema.outreachBroadcastRecipients).values(
        audience.members.slice(i, i + RECIPIENT_INSERT_CHUNK).map((m) => ({
          orgId: actor.orgId,
          broadcastId: row.id,
          contactId: m.contactId,
          address: m.address,
        })),
      );
    }
    await ctx.db
      .update(schema.outreachBroadcasts)
      .set({
        status: 'approved',
        approvedHtml: compiled.html,
        approvedFingerprint: fingerprint,
        approvedAudienceCount: audience.members.length,
        scheduledSendAt,
        cancelReason: null,
        decidedByActorType: actor.type,
        decidedByActorId: actor.id,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.outreachBroadcasts.id, row.id));
    await this.webhooks.emit({
      type: 'outreach.broadcast.approved',
      payload: {
        broadcastId: row.id,
        audienceCount: audience.members.length,
        scheduledSendAt: scheduledSendAt.toISOString(),
      },
    });
    return this.getBroadcast(row.id);
  }

  async dismissBroadcast(input: { id: string; reason?: string | null }): Promise<BroadcastDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const row = await this.loadBroadcast(input.id);
    assertStatus(row, ['pending'], 'dismissed');
    const now = new Date();
    await ctx.db
      .update(schema.outreachBroadcasts)
      .set({
        status: 'dismissed',
        dismissReason: input.reason?.trim() || null,
        decidedByActorType: actor.type,
        decidedByActorId: actor.id,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.outreachBroadcasts.id, row.id));
    await this.webhooks.emit({
      type: 'outreach.broadcast.dismissed',
      payload: { broadcastId: row.id, reason: input.reason?.trim() || null },
    });
    return this.getBroadcast(row.id);
  }

  async cancelBroadcast(input: { id: string; reason: string }): Promise<BroadcastDto> {
    const ctx = getCurrentContext();
    const row = await this.loadBroadcast(input.id);
    assertStatus(row, ['approved', 'sending'], 'cancelled');
    const reason = requireText(input.reason, 'reason');
    const now = new Date();
    if (row.status === 'approved') {
      const returned = await ctx.db
        .update(schema.outreachBroadcasts)
        .set({
          status: 'pending',
          scheduledSendAt: null,
          approvedHtml: null,
          approvedFingerprint: null,
          approvedAudienceCount: null,
          decidedByActorType: null,
          decidedByActorId: null,
          decidedAt: null,
          cancelReason: reason,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.outreachBroadcasts.id, row.id),
            eq(schema.outreachBroadcasts.status, 'approved'),
          ),
        )
        .returning({ id: schema.outreachBroadcasts.id });
      if (returned.length > 0) {
        await ctx.db
          .delete(schema.outreachBroadcastRecipients)
          .where(eq(schema.outreachBroadcastRecipients.broadcastId, row.id));
        await this.webhooks.emit({
          type: 'outreach.broadcast.canceled',
          payload: { broadcastId: row.id, reason, sent: 0, returnedToReview: true },
        });
        return this.getBroadcast(row.id);
      }
    }
    await ctx.db
      .update(schema.outreachBroadcastRecipients)
      .set({ status: 'skipped', skipReason: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(schema.outreachBroadcastRecipients.broadcastId, row.id),
          eq(schema.outreachBroadcastRecipients.status, 'queued'),
        ),
      );
    await ctx.db
      .update(schema.outreachBroadcasts)
      .set({ status: 'cancelled', cancelReason: reason, completedAt: now, updatedAt: now })
      .where(eq(schema.outreachBroadcasts.id, row.id));
    const counts = (await this.countsFor([row.id])).get(row.id) ?? emptyCounts();
    await this.webhooks.emit({
      type: 'outreach.broadcast.canceled',
      payload: { broadcastId: row.id, reason, sent: counts.sent, returnedToReview: false },
    });
    return this.getBroadcast(row.id);
  }

  async sendBroadcastTest(input: {
    id: string;
    to?: string | null;
  }): Promise<{ sent: true; to: string; messageId: string }> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const row = await this.loadBroadcast(input.id);
    const to = await this.resolveTestAddress(input.to ?? null);
    const channel = await this.loadEmailChannel(row.channelId);
    const html =
      row.approvedHtml ??
      (await compileEmail((await this.resolveTemplate(row.emailTemplateId)).mjml, contentOf(row)))
        .html;
    const personalized = personalizeEmail(html, {
      name: null,
      orgName: await this.orgName(),
      subject: row.subject,
      preheader: row.preheader,
      unsubscribeUrl: broadcastUnsubscribeUrl(actor.orgId, TEST_SEND_CONTACT_ID, row.id),
    });
    const [result] = await this.mail.sendBulk(channel, [
      {
        key: 'test',
        to,
        subject: `[Test] ${row.subject}`,
        html: personalized.html,
        text: personalized.text,
        replyKey: 'test',
      },
    ]);
    if (!result?.messageId) {
      throw new OutreachInvalidError(
        `test send to ${to} failed: ${result?.error ?? 'no result from the channel'}`,
      );
    }
    return { sent: true, to, messageId: result.messageId };
  }

  async startDueBroadcast(id: string): Promise<BroadcastStatus> {
    const ctx = getCurrentContext();
    const row = await this.loadBroadcast(id);
    if (row.status !== 'approved') return row.status as BroadcastStatus;
    const started = await ctx.db
      .update(schema.outreachBroadcasts)
      .set({ status: 'sending', startedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.outreachBroadcasts.id, id),
          eq(schema.outreachBroadcasts.status, 'approved'),
        ),
      )
      .returning({ id: schema.outreachBroadcasts.id });
    if (started.length > 0) {
      await this.webhooks.emit({
        type: 'outreach.broadcast.started',
        payload: { broadcastId: id, audienceCount: row.approvedAudienceCount },
      });
    }
    return 'sending';
  }

  async claimBatch(id: string, budget: number): Promise<ClaimedBatch> {
    const ctx = getCurrentContext();
    const row = await this.loadBroadcast(id);
    const none: ClaimedBatch = {
      broadcastId: id,
      channel: null,
      pausedReason: null,
      messages: [],
      skipped: 0,
    };
    if (row.status !== 'sending' || budget <= 0) return none;

    const channel = await this.loadChannelRow(row.channelId);
    if (!channel?.active || channel.type !== 'email') {
      const pausedReason = `channel ${row.channelId} is not an active email channel; sending resumes when it is`;
      await ctx.db
        .update(schema.outreachBroadcasts)
        .set({ failureReason: pausedReason, updatedAt: new Date() })
        .where(eq(schema.outreachBroadcasts.id, id));
      return { ...none, pausedReason };
    }
    if (row.failureReason) {
      await ctx.db
        .update(schema.outreachBroadcasts)
        .set({ failureReason: null, updatedAt: new Date() })
        .where(eq(schema.outreachBroadcasts.id, id));
    }

    const allowance = Math.min(budget, await this.hourlyAllowance(row));
    if (allowance <= 0) return { ...none, channel };

    const r = schema.outreachBroadcastRecipients;
    const queued = await ctx.db
      .select()
      .from(r)
      .where(
        and(
          eq(r.broadcastId, id),
          eq(r.status, 'queued'),
          or(isNull(r.notBefore), lte(r.notBefore, new Date())),
        ),
      )
      .orderBy(asc(r.id))
      .limit(allowance)
      .for('update', { skipLocked: true });
    if (queued.length === 0) return { ...none, channel };

    const contactIds = queued.map((q) => q.contactId).filter((c): c is string => c !== null);
    const contacts = new Map(
      (contactIds.length
        ? await ctx.db
            .select({
              id: schema.crmContacts.id,
              name: schema.crmContacts.name,
              doNotContact: schema.crmContacts.doNotContact,
              unsubscribedAt: schema.crmContacts.unsubscribedAt,
              consentLawfulBasis: schema.crmContacts.consentLawfulBasis,
            })
            .from(schema.crmContacts)
            .where(
              and(
                eq(schema.crmContacts.orgId, row.orgId),
                inArray(schema.crmContacts.id, contactIds),
              ),
            )
        : []
      ).map((c) => [c.id, c]),
    );
    const undeliverable = new Set(
      (
        await ctx.db
          .select({ address: schema.crmAddressDeliverability.address })
          .from(schema.crmAddressDeliverability)
          .where(
            and(
              eq(schema.crmAddressDeliverability.orgId, row.orgId),
              inArray(
                schema.crmAddressDeliverability.address,
                queued.map((q) => q.address),
              ),
              eq(schema.crmAddressDeliverability.state, 'undeliverable'),
            ),
          )
      ).map((d) => d.address),
    );

    const orgName = await this.orgName();
    const now = new Date();
    const timing = await checkSendPolicyBatch({
      contactIds: queued.map((q) => q.contactId).filter((c): c is string => c !== null && contacts.has(c)),
      policy: { channel: 'email', class: 'marketing', cooldownHoursAfterConversation: 0 },
      now,
    });
    const messages: BulkEmail[] = [];
    let skipped = 0;
    for (const recipient of queued) {
      const contact = recipient.contactId ? contacts.get(recipient.contactId) : undefined;
      const decision = recipient.contactId ? timing.get(recipient.contactId) : undefined;
      if (decision?.decision === 'defer' && decision.reason !== 'frequency_cap') {
        await ctx.db
          .update(r)
          .set({ notBefore: decision.until, updatedAt: now })
          .where(eq(r.id, recipient.id));
        continue;
      }
      const skipReason = !contact
        ? 'contact_removed'
        : contact.unsubscribedAt
          ? 'unsubscribed'
          : contact.doNotContact
            ? 'do_not_contact'
            : !contact.consentLawfulBasis
              ? 'no_lawful_basis'
              : undeliverable.has(recipient.address)
                ? 'undeliverable'
                : decision?.decision === 'defer'
                  ? 'frequency_cap'
                  : decision?.decision === 'skip'
                    ? decision.reason
                    : null;
      if (skipReason) {
        skipped += 1;
        await ctx.db
          .update(r)
          .set({ status: 'skipped', skipReason, updatedAt: now })
          .where(eq(r.id, recipient.id));
        continue;
      }
      const link = broadcastUnsubscribeUrl(row.orgId, recipient.contactId!, row.id);
      const personalized = personalizeEmail(row.approvedHtml ?? '', {
        name: contact!.name,
        orgName,
        subject: row.subject,
        preheader: row.preheader,
        unsubscribeUrl: link,
      });
      messages.push({
        key: recipient.id,
        to: recipient.address,
        subject: row.subject,
        html: personalized.html,
        text: personalized.text,
        replyKey: recipient.id,
        listUnsubscribeUrl: link,
      });
      await ctx.db
        .update(r)
        .set({ status: 'sending', attempts: recipient.attempts + 1, updatedAt: now })
        .where(eq(r.id, recipient.id));
    }
    return { broadcastId: id, channel, pausedReason: null, messages, skipped };
  }

  async recordBatch(id: string, results: readonly BulkEmailResult[]): Promise<void> {
    const ctx = getCurrentContext();
    const r = schema.outreachBroadcastRecipients;
    const now = new Date();
    for (const result of results) {
      if (result.messageId) {
        const [sent] = await ctx.db
          .update(r)
          .set({
            status: 'sent',
            messageIdHeader: result.messageId,
            sentAt: now,
            failureReason: null,
            updatedAt: now,
          })
          .where(and(eq(r.id, result.key), eq(r.broadcastId, id)))
          .returning({ contactId: r.contactId });
        if (sent?.contactId) {
          await ctx.db
            .update(schema.crmContacts)
            .set({ lastContactedAt: now, updatedAt: now })
            .where(eq(schema.crmContacts.id, sent.contactId));
        }
        continue;
      }
      const [current] = await ctx.db
        .select({ attempts: r.attempts })
        .from(r)
        .where(and(eq(r.id, result.key), eq(r.broadcastId, id)))
        .limit(1);
      if (!current) continue;
      await ctx.db
        .update(r)
        .set({
          status: current.attempts >= MAX_BROADCAST_SEND_ATTEMPTS ? 'failed' : 'queued',
          failureReason: result.error,
          updatedAt: now,
        })
        .where(eq(r.id, result.key));
    }
  }

  async finishIfDone(id: string): Promise<boolean> {
    const ctx = getCurrentContext();
    const row = await this.loadBroadcast(id);
    if (row.status !== 'sending') return false;
    const r = schema.outreachBroadcastRecipients;
    const [open] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(r)
      .where(and(eq(r.broadcastId, id), inArray(r.status, ['queued', 'sending'])))
      .limit(1);
    if ((open?.n ?? 0) > 0) return false;
    const counts = (await this.countsFor([id])).get(id) ?? emptyCounts();
    const status: BroadcastStatus = counts.sent > 0 || counts.failed === 0 ? 'sent' : 'failed';
    const now = new Date();
    await ctx.db
      .update(schema.outreachBroadcasts)
      .set({
        status,
        completedAt: now,
        failureReason: status === 'failed' ? 'no recipient could be sent to' : row.failureReason,
        updatedAt: now,
      })
      .where(and(eq(schema.outreachBroadcasts.id, id), eq(schema.outreachBroadcasts.status, 'sending')));
    await this.webhooks.emit({
      type: 'outreach.broadcast.completed',
      payload: {
        broadcastId: id,
        status,
        sent: counts.sent,
        skipped: counts.skipped,
        failed: counts.failed,
      },
    });
    return true;
  }

  private async hourlyAllowance(row: BroadcastRow): Promise<number> {
    if (!row.maxPerHour) return Number.POSITIVE_INFINITY;
    const ctx = getCurrentContext();
    const r = schema.outreachBroadcastRecipients;
    const [recent] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(r)
      .where(
        and(
          eq(r.broadcastId, row.id),
          gte(r.sentAt, new Date(Date.now() - 60 * 60 * 1000)),
        ),
      );
    return row.maxPerHour - (recent?.n ?? 0);
  }

  private async computeAudience(
    segmentId: string,
  ): Promise<{ members: AudienceMember[]; preview: AudiencePreview }> {
    const ctx = getCurrentContext();
    const [segment] = await ctx.db
      .select({ filterDefinition: schema.crmSegments.filterDefinition })
      .from(schema.crmSegments)
      .where(eq(schema.crmSegments.id, segmentId))
      .limit(1);
    if (!segment) throw new OutreachInvalidError(`segment ${segmentId} does not exist`);
    const c = schema.crmContacts;
    const d = schema.crmAddressDeliverability;
    const rows = await ctx.db
      .select({
        id: c.id,
        name: c.name,
        email: c.email,
        doNotContact: c.doNotContact,
        unsubscribedAt: c.unsubscribedAt,
        consentLawfulBasis: c.consentLawfulBasis,
        deliverability: d.state,
      })
      .from(c)
      .leftJoin(d, and(eq(d.orgId, c.orgId), eq(d.address, sql`lower(btrim(${c.email}))`)))
      .where(and(...segmentMatchFilters(segment.filterDefinition)))
      .orderBy(asc(c.createdAt), asc(c.id));

    const excluded = Object.fromEntries(
      AUDIENCE_EXCLUSION_REASONS.map((reason) => [reason, 0]),
    ) as Record<AudienceExclusionReason, number>;
    const seen = new Set<string>();
    const members: AudienceMember[] = [];
    for (const row of rows) {
      const address = normalizeAddress(row.email);
      const reason: AudienceExclusionReason | null = row.unsubscribedAt
        ? 'unsubscribed'
        : row.doNotContact
          ? 'do_not_contact'
          : !row.consentLawfulBasis
            ? 'no_lawful_basis'
            : !address
              ? 'no_email'
              : row.deliverability === 'undeliverable'
                ? 'undeliverable'
                : seen.has(address)
                  ? 'duplicate_address'
                  : null;
      if (reason) {
        excluded[reason] += 1;
        continue;
      }
      seen.add(address!);
      members.push({ contactId: row.id, name: row.name, address: address! });
    }
    return {
      members,
      preview: {
        eligible: members.length,
        excluded,
        sample: members.slice(0, AUDIENCE_SAMPLE_SIZE),
        frozen: false,
      },
    };
  }

  private async renderPreview(
    row: BroadcastRow,
    compiledHtml: string,
    warnings: string[],
    sample: { contactId: string | null; name: string | null; address: string | null } | null,
  ): Promise<BroadcastPreview> {
    const personalized = personalizeEmail(compiledHtml, {
      name: sample?.name ?? null,
      orgName: await this.orgName(),
      subject: row.subject,
      preheader: row.preheader,
      unsubscribeUrl: `${stripTrailingSlashes(readApiBaseUrl())}/v1/outreach/unsubscribe?token=preview`,
    });
    return {
      html: personalized.html,
      text: personalized.text,
      htmlBytes: Buffer.byteLength(personalized.html, 'utf8'),
      warnings,
      recipient: sample
        ? { contactId: sample.contactId, name: sample.name, address: sample.address }
        : emptyRecipient(),
    };
  }

  private async firstRecipient(
    broadcastId: string,
  ): Promise<{ contactId: string | null; name: string | null; address: string } | null> {
    const ctx = getCurrentContext();
    const r = schema.outreachBroadcastRecipients;
    const [row] = await ctx.db
      .select({ contactId: r.contactId, address: r.address, name: schema.crmContacts.name })
      .from(r)
      .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, r.contactId))
      .where(eq(r.broadcastId, broadcastId))
      .orderBy(asc(r.id))
      .limit(1);
    return row ?? null;
  }

  private async countsFor(ids: string[]): Promise<Map<string, BroadcastCounts>> {
    if (ids.length === 0) return new Map();
    const ctx = getCurrentContext();
    const r = schema.outreachBroadcastRecipients;
    const d = schema.crmAddressDeliverability;
    const rows = await ctx.db
      .select({
        broadcastId: r.broadcastId,
        queued: sql<number>`count(*) filter (where ${r.status} in ('queued', 'sending'))::int`,
        sent: sql<number>`count(*) filter (where ${r.status} = 'sent')::int`,
        skipped: sql<number>`count(*) filter (where ${r.status} = 'skipped')::int`,
        failed: sql<number>`count(*) filter (where ${r.status} = 'failed')::int`,
        replied: sql<number>`count(*) filter (where ${r.repliedAt} is not null)::int`,
        unsubscribed: sql<number>`count(*) filter (where ${r.unsubscribedAt} is not null)::int`,
        bounced: sql<number>`count(*) filter (where ${r.status} = 'sent' and ${d.state} = 'undeliverable' and ${d.lastFailureAt} >= ${r.sentAt})::int`,
      })
      .from(r)
      .leftJoin(d, and(eq(d.orgId, r.orgId), eq(d.address, r.address)))
      .where(inArray(r.broadcastId, ids))
      .groupBy(r.broadcastId);
    return new Map(rows.map(({ broadcastId, ...counts }) => [broadcastId, counts]));
  }

  private async resolveTemplate(templateId: string | null): Promise<{ id: string | null; mjml: string }> {
    const ctx = getCurrentContext();
    const t = schema.outreachEmailTemplates;
    const [row] = await ctx.db
      .select({ id: t.id, mjml: t.mjml })
      .from(t)
      .where(
        and(
          eq(t.orgId, ctx.actor!.orgId),
          templateId ? eq(t.id, templateId) : eq(t.isDefault, true),
        ),
      )
      .limit(1);
    if (templateId && !row) {
      throw new OutreachInvalidError(`email template ${templateId} does not exist`);
    }
    return row ?? { id: null, mjml: BUILT_IN_EMAIL_TEMPLATE };
  }

  private async resolveTestAddress(requested: string | null): Promise<string> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const members = await ctx.db
      .select({ userId: schema.users.id, email: schema.users.email })
      .from(schema.orgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
      .where(eq(schema.orgMembers.orgId, actor.orgId));
    if (requested) {
      const wanted = normalizeAddress(requested);
      const match = members.find((m) => normalizeAddress(m.email) === wanted);
      if (!match) {
        throw new OutreachInvalidError(
          `test sends go only to members of this organization; ${requested} is not one`,
        );
      }
      return match.email;
    }
    const self = actor.type === 'user' ? members.find((m) => m.userId === actor.id) : undefined;
    if (!self) {
      throw new OutreachInvalidError(
        'pass `to` with the email address of a member of this organization to receive the test',
      );
    }
    return self.email;
  }

  private async loadBroadcast(id: string): Promise<BroadcastRow> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.outreachBroadcasts)
      .where(eq(schema.outreachBroadcasts.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`outreach_not_found: broadcast ${id}`);
    return row;
  }

  private async loadChannelRow(channelId: string): Promise<(ChannelRow & { active: boolean }) | null> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select()
      .from(schema.convChannels)
      .where(eq(schema.convChannels.id, channelId))
      .limit(1);
    return row ?? null;
  }

  private async loadEmailChannel(channelId: string): Promise<ChannelRow> {
    const channel = await this.loadChannelRow(channelId);
    if (!channel) throw new OutreachInvalidError(`channel ${channelId} does not exist`);
    if (channel.type !== 'email') {
      throw new OutreachInvalidError(
        `channel ${channelId} is ${channel.type}; broadcasts are sent on an email channel`,
      );
    }
    if (!channel.active) throw new OutreachInvalidError(`channel ${channelId} is not active`);
    return channel;
  }

  private async assertSegmentExists(segmentId: string): Promise<void> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ id: schema.crmSegments.id })
      .from(schema.crmSegments)
      .where(eq(schema.crmSegments.id, segmentId))
      .limit(1);
    if (!row) throw new OutreachInvalidError(`segment ${segmentId} does not exist`);
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const ctx = getCurrentContext();
    const b = schema.outreachBroadcasts;
    const [taken] = await ctx.db
      .select({ id: b.id })
      .from(b)
      .where(
        and(
          eq(b.orgId, ctx.actor!.orgId),
          eq(b.name, name),
          exceptId ? ne(b.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    if (taken) {
      throw new ConflictException(`outreach_conflict: broadcast with name "${name}" already exists`);
    }
  }

  private async orgName(): Promise<string | null> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({ name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, ctx.actor!.orgId))
      .limit(1);
    return row?.name ?? null;
  }
}

export function broadcastFingerprint(
  compiledHtml: string,
  row: Pick<BroadcastRow, 'subject' | 'preheader' | 'scheduledSendAt' | 'channelId'>,
  audienceCount: number,
): string {
  const canonical = JSON.stringify([
    compiledHtml,
    row.subject,
    row.preheader ?? null,
    row.scheduledSendAt ? row.scheduledSendAt.toISOString() : null,
    row.channelId,
    audienceCount,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

export async function recoverStaleSends(db: Pick<Tx, 'update'>): Promise<number> {
  const r = schema.outreachBroadcastRecipients;
  const stale = await db
    .update(r)
    .set({
      status: 'failed',
      failureReason:
        'delivery outcome unknown: the send was interrupted mid-batch, and it is not retried so nobody gets the message twice',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(r.status, 'sending'),
        lt(r.updatedAt, new Date(Date.now() - STALE_SENDING_MINUTES * 60 * 1000)),
      ),
    )
    .returning({ id: r.id });
  return stale.length;
}

export function broadcastUnsubscribeUrl(orgId: string, contactId: string, broadcastId: string): string {
  const token = signUnsubscribeToken({ orgId, contactId, campaignId: broadcastId });
  return `${stripTrailingSlashes(readApiBaseUrl())}/v1/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
}

function contentOf(row: BroadcastRow): EmailContent {
  return { format: row.contentFormat as EmailContentFormat, body: row.body };
}

function assertStatus(row: BroadcastRow, allowed: BroadcastStatus[], verb: string): void {
  if (!allowed.includes(row.status as BroadcastStatus)) {
    throw new ConflictException({
      message: `outreach_broadcast_state: broadcast ${row.id} is ${row.status}; only ${allowed.join(' or ')} broadcasts can be ${verb}`,
      code: 'outreach_broadcast_state',
    });
  }
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new OutreachInvalidError(`${field} must be non-empty`);
  return trimmed;
}

function parseSendAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new OutreachInvalidError(`send time ${value} is not an ISO 8601 timestamp`);
  }
  return date;
}

function readMaxAudience(): number {
  const raw = Number(process.env.MUNIN_OUTREACH_BROADCAST_MAX_AUDIENCE);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_AUDIENCE;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}

function decisionOutcome(status: string): ReviewDecisionOutcome {
  if (status === 'dismissed') return 'dismissed';
  if (status === 'failed') return 'failed';
  return 'approved';
}

function emptyCounts(): BroadcastCounts {
  return { queued: 0, sent: 0, skipped: 0, failed: 0, replied: 0, unsubscribed: 0, bounced: 0 };
}

function emptyRecipient(): BroadcastPreview['recipient'] {
  return { contactId: null, name: null, address: null };
}

function frozenAudience(row: BroadcastRow, counts: BroadcastCounts): AudiencePreview {
  return {
    eligible: row.approvedAudienceCount ?? counts.queued + counts.sent + counts.skipped + counts.failed,
    excluded: Object.fromEntries(AUDIENCE_EXCLUSION_REASONS.map((r) => [r, 0])) as Record<
      AudienceExclusionReason,
      number
    >,
    sample: [],
    frozen: true,
  };
}

function toSummary(row: BroadcastRow, counts: BroadcastCounts): BroadcastSummaryDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status as BroadcastStatus,
    segmentId: row.segmentId,
    channelId: row.channelId,
    emailTemplateId: row.emailTemplateId,
    subject: row.subject,
    scheduledSendAt: row.scheduledSendAt?.toISOString() ?? null,
    approvedAudienceCount: row.approvedAudienceCount,
    counts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

function toDto(
  row: BroadcastRow,
  counts: BroadcastCounts,
  extra: { fingerprint: string; audience: AudiencePreview; preview: BroadcastPreview },
): BroadcastDto {
  return {
    ...toSummary(row, counts),
    preheader: row.preheader,
    content: contentOf(row),
    maxPerHour: row.maxPerHour,
    contentFingerprint: extra.fingerprint,
    audience: extra.audience,
    preview: extra.preview,
    proposedByActorType: row.proposedByActorType,
    proposedByActorId: row.proposedByActorId,
    decidedByActorType: row.decidedByActorType,
    decidedByActorId: row.decidedByActorId,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    dismissReason: row.dismissReason,
    cancelReason: row.cancelReason,
    failureReason: row.failureReason,
  };
}

function toRecipientDto(
  row: typeof schema.outreachBroadcastRecipients.$inferSelect,
): BroadcastRecipientDto {
  return {
    id: row.id,
    contactId: row.contactId,
    address: row.address,
    status: row.status as BroadcastRecipientStatus,
    skipReason: row.skipReason,
    failureReason: row.failureReason,
    attempts: row.attempts,
    sentAt: row.sentAt?.toISOString() ?? null,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
    conversationId: row.conversationId,
  };
}
