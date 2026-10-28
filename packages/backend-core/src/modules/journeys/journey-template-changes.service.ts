import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import { JourneySpecSchema } from '@getmunin/types';
import { AlertsService } from '../system-alerts/system-alerts.service.ts';
import { emailTemplateHash } from '../outreach/email-template-hash.ts';
import { dashboardPath, dashboardUrl } from '../../common/web-url.ts';
import { parseJourneyDelivery, type JourneyDelivery } from '../outreach/journey-delivery.ts';
import { journeyTemplateAlertSubject } from '../outreach/journey-outbox.service.ts';
import { JourneysService } from './journeys.service.ts';

export interface TemplateChangeDto {
  version: number;
  nodeId: string;
  templateId: string | null;
  templateName: string | null;
  deleted: boolean;
}

export interface TemplateChangesDto {
  journeyId: string;
  changes: TemplateChangeDto[];
  heldMessages: number;
  fingerprint: string | null;
  reviewPath: string;
  reviewUrl: string;
  released?: number;
}

interface PinnedChange extends TemplateChangeDto {
  versionId: string;
  pinnedHash: string;
  currentHash: string | null;
}

interface HeldMessage {
  id: string;
  delivery: JourneyDelivery;
}

@Injectable()
export class JourneyTemplateChangesService {
  constructor(
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(JourneysService) private readonly journeys: Pick<JourneysService, 'get'>,
    @Inject(AlertsService) private readonly alerts: Pick<AlertsService, 'resolveAlert'>,
  ) {}

  async list(journeyId: string): Promise<TemplateChangesDto> {
    await this.journeys.get(journeyId);
    const changes = await this.pinnedChanges(journeyId);
    const held = await this.heldMessages(journeyId, changes);
    return toDto(journeyId, changes, held.length);
  }

  async reapprove(journeyId: string, fingerprint: string): Promise<TemplateChangesDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (actor.type !== 'user') {
      throw new ForbiddenException(
        'journeys_forbidden: only a person signed in to the Munin dashboard can approve a changed email template',
      );
    }
    await this.journeys.get(journeyId);
    const changes = await this.pinnedChanges(journeyId);
    if (changes.length === 0) {
      throw new ConflictException(`journeys_conflict: no email template used by journey ${journeyId} has changed`);
    }
    if (changesFingerprint(journeyId, changes) !== fingerprint) {
      throw new ConflictException(
        'journeys_conflict: the email templates changed again after you reviewed them — review the current templates and approve those',
      );
    }
    const deleted = changes.filter((c) => c.deleted);
    if (deleted.length > 0) {
      throw new BadRequestException(
        `journeys_invalid: ${deleted.map((c) => `"${c.nodeId}"`).join(', ')} use an email template that was deleted — publish a version that uses another template`,
      );
    }

    const held = await this.heldMessages(journeyId, changes);
    const now = new Date();
    const byVersion = new Map<string, Record<string, string>>();
    for (const change of changes) {
      const pins = byVersion.get(change.versionId) ?? {};
      pins[change.nodeId] = change.currentHash!;
      byVersion.set(change.versionId, pins);
    }
    for (const [versionId, pins] of byVersion) {
      const [row] = await ctx.db
        .select({ pinned: schema.journeyVersions.pinnedTemplates })
        .from(schema.journeyVersions)
        .where(eq(schema.journeyVersions.id, versionId))
        .limit(1);
      await ctx.db
        .update(schema.journeyVersions)
        .set({ pinnedTemplates: { ...(row?.pinned ?? {}), ...pins }, updatedAt: now })
        .where(eq(schema.journeyVersions.id, versionId));
    }
    const current = currentHashes(changes);
    for (const message of held) {
      await ctx.db
        .update(schema.outreachProposals)
        .set({
          journeyDelivery: { ...message.delivery, templateHash: current.get(message.delivery.templateId)! },
          scheduledSendAt: now,
          updatedAt: now,
        })
        .where(and(eq(schema.outreachProposals.id, message.id), eq(schema.outreachProposals.status, 'approved')));
    }
    await this.alerts.resolveAlert({ source: 'journeys', subjectId: journeyTemplateAlertSubject(journeyId) });
    await this.webhooks.emit({
      type: 'journey.templates.reapproved',
      payload: {
        journeyId,
        nodes: changes.map((c) => ({ version: c.version, nodeId: c.nodeId, templateId: c.templateId })),
        released: held.length,
        approvedBy: actor.id,
      },
    });
    return toDto(journeyId, [], 0, held.length);
  }

  private async pinnedChanges(journeyId: string): Promise<PinnedChange[]> {
    const ctx = getCurrentContext();
    const versions = await ctx.db
      .select({
        id: schema.journeyVersions.id,
        number: schema.journeyVersions.number,
        spec: schema.journeyVersions.spec,
        pinned: schema.journeyVersions.pinnedTemplates,
      })
      .from(schema.journeyVersions)
      .where(and(eq(schema.journeyVersions.journeyId, journeyId), isNotNull(schema.journeyVersions.publishedAt)));
    const hashes = new Map<string | null, string | null>();
    const changes: PinnedChange[] = [];
    for (const version of versions.sort((a, b) => a.number - b.number)) {
      const parsed = JourneySpecSchema.safeParse(version.spec);
      if (!parsed.success) continue;
      for (const [nodeId, pinnedHash] of Object.entries(version.pinned)) {
        const node = parsed.data.nodes.find((n) => n.id === nodeId);
        if (node?.type !== 'message' || node.channel !== 'email') continue;
        const templateId = node.content.templateId ?? null;
        if (!hashes.has(templateId)) hashes.set(templateId, await emailTemplateHash(templateId));
        const currentHash = hashes.get(templateId)!;
        if (currentHash === pinnedHash) continue;
        changes.push({
          versionId: version.id,
          version: version.number,
          nodeId,
          templateId,
          templateName: null,
          deleted: currentHash === null,
          pinnedHash,
          currentHash,
        });
      }
    }
    const ids = [...new Set(changes.map((c) => c.templateId).filter((id): id is string => id !== null))];
    if (ids.length > 0) {
      const names = await ctx.db
        .select({ id: schema.outreachEmailTemplates.id, name: schema.outreachEmailTemplates.name })
        .from(schema.outreachEmailTemplates)
        .where(inArray(schema.outreachEmailTemplates.id, ids));
      const byId = new Map(names.map((n) => [n.id, n.name]));
      for (const change of changes) if (change.templateId) change.templateName = byId.get(change.templateId) ?? null;
    }
    return changes;
  }

  private async heldMessages(journeyId: string, changes: PinnedChange[]): Promise<HeldMessage[]> {
    if (changes.length === 0) return [];
    const ctx = getCurrentContext();
    const p = schema.outreachProposals;
    const rows = await ctx.db
      .select({ id: p.id, delivery: p.journeyDelivery })
      .from(p)
      .innerJoin(schema.journeyEnrollments, eq(schema.journeyEnrollments.id, p.journeyEnrollmentId))
      .where(
        and(
          eq(schema.journeyEnrollments.journeyId, journeyId),
          eq(p.kind, 'journey'),
          eq(p.status, 'approved'),
          isNotNull(p.scheduledSendAt),
        ),
      );
    const current = currentHashes(changes);
    const held: HeldMessage[] = [];
    for (const row of rows) {
      const delivery = parseJourneyDelivery(row.id, row.delivery);
      if (delivery.channel !== 'email' || !delivery.auto || !current.has(delivery.templateId)) continue;
      if (delivery.templateHash !== current.get(delivery.templateId)) held.push({ id: row.id, delivery });
    }
    return held;
  }
}

function currentHashes(changes: PinnedChange[]): Map<string | null, string | null> {
  return new Map(changes.map((c) => [c.templateId, c.currentHash]));
}

function changesFingerprint(journeyId: string, changes: PinnedChange[]): string {
  const canonical = JSON.stringify([
    journeyId,
    changes
      .map((c) => [c.version, c.nodeId, c.templateId, c.pinnedHash, c.currentHash])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

function toDto(journeyId: string, changes: PinnedChange[], heldMessages: number, released?: number): TemplateChangesDto {
  return {
    journeyId,
    changes: changes.map((c) => ({
      version: c.version,
      nodeId: c.nodeId,
      templateId: c.templateId,
      templateName: c.templateName,
      deleted: c.deleted,
    })),
    heldMessages,
    fingerprint: changes.length > 0 ? changesFingerprint(journeyId, changes) : null,
    reviewPath: dashboardPath(getCurrentContext().actor!.orgId, `/journeys/${journeyId}?templates=review`),
    reviewUrl: dashboardUrl(getCurrentContext().actor!.orgId, `/journeys/${journeyId}?templates=review`),
    ...(released === undefined ? {} : { released }),
  };
}
