import { Injectable, Inject } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { newImportResult, resolveId } from '../../common/transfer/transfer.helpers.ts';
import type { IdMap, ImportResult } from '../../common/transfer/transfer.types.ts';
import {
  chunkDocument,
  contentHash,
  getCurrentContext,
  isSystemRuntimeDoc,
  WebhookDispatcher,
} from '@getmunin/core';
import type { ActorIdentity, Audience } from '@getmunin/core';
import { EmbeddingProviderHolder } from './embedding.provider.ts';
import { QUOTAS_SERVICE, type QuotasService } from '../../common/quotas/quotas.service.ts';

const AUDIENCES: readonly Audience[] = ['admin', 'self_service'];

function normaliseAudiences(input: readonly string[] | undefined, fallback: readonly Audience[] = ['admin']): Audience[] {
  if (!input) return [...fallback];
  const dedup = new Set<Audience>();
  for (const v of input) {
    if ((AUDIENCES as readonly string[]).includes(v)) dedup.add(v as Audience);
  }
  if (dedup.size === 0) {
    throw new KbInvalidError(`audiences must be a non-empty subset of ${AUDIENCES.join(', ')}`);
  }
  return Array.from(dedup);
}

export class KbConflictError extends Error {
  readonly code = 'kb_version_conflict';
  constructor(public readonly currentVersion: number, public readonly providedVersion: number) {
    super(
      `kb_version_conflict: document is at version ${currentVersion}, write expected ${providedVersion}`,
    );
  }
}

export class KbNotFoundError extends Error {
  readonly code = 'kb_not_found';
  constructor(kind: string, id: string) {
    super(`kb_not_found: no ${kind} with id ${id} in this org`);
  }
}

export class KbInvalidError extends Error {
  readonly code = 'kb_invalid';
  constructor(message: string) {
    super(`kb_invalid: ${message}`);
  }
}

export class KbCurationDecidedError extends Error {
  readonly code = 'kb_curation_decided';
  constructor(
    public readonly sourceConversationId: string,
    public readonly outcome: string,
    decidedAt: string,
    sourceMessageId?: string | null,
  ) {
    const from = sourceMessageId
      ? `message ${sourceMessageId} of conversation ${sourceConversationId}`
      : `conversation ${sourceConversationId}`;
    super(
      outcome === 'published'
        ? `kb_curation_decided: a candidate from ${from} was already published on ${decidedAt} — that knowledge is in the KB, so do not refile it. Create a document directly with kb_create_document if something genuinely new came up.`
        : `kb_curation_decided: a candidate from ${from} was dismissed on ${decidedAt} and dismissals are permanent — do not refile it. Read the decision with kb_list_curation_decisions.`,
    );
  }
}

export interface SpaceDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDto {
  id: string;
  spaceId: string;
  slug: string | null;
  title: string;
  body: string;
  audiences: Audience[];
  version: number;
  tags: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CurationCandidateRefs {
  proposedTargetSpaceSlug: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  revisesDocumentId: string | null;
}

export interface RevisedDocumentRef {
  revisesDocumentTitle: string | null;
  revisesDocumentVersion: number | null;
}

export interface CurationCandidateSummary
  extends DocumentSummary,
    CurationCandidateRefs,
    RevisedDocumentRef {}

export interface CurationCandidateDto extends DocumentDto, CurationCandidateRefs, RevisedDocumentRef {
  revisesDocumentBody: string | null;
}

export type CurationOutcome = 'dismissed' | 'published';

export interface CurationDecisionDto {
  id: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  candidateDocumentId: string;
  title: string;
  outcome: CurationOutcome;
  reason: string | null;
  publishedDocumentId: string | null;
  decidedByActorType: string;
  decidedByActorId: string;
  decidedAt: string;
}

export interface DocumentSummary {
  id: string;
  spaceId: string;
  slug: string | null;
  title: string;
  audiences: Audience[];
  version: number;
  tags: string[];
  updatedAt: string;
}

export interface VersionDto {
  id: string;
  documentId: string;
  version: number;
  title: string;
  body: string;
  audiences: Audience[];
  tags: string[];
  createdAt: string;
}

export interface KbSpaceExport {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface KbDocumentExport {
  id: string;
  spaceId: string;
  slug: string | null;
  title: string;
  body: string;
  audiences: Audience[];
  tags: string[];
}

export interface KbExportData {
  spaces: KbSpaceExport[];
  documents: KbDocumentExport[];
}

@Injectable()
export class KbService {
  constructor(
    @Inject(EmbeddingProviderHolder) private readonly embeddings: EmbeddingProviderHolder,
    @Inject(QUOTAS_SERVICE) private readonly quotas: QuotasService,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
  ) {}

  async listSpaces(): Promise<SpaceDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.kbSpaces)
      .orderBy(asc(schema.kbSpaces.name));
    return rows.map(toSpaceDto);
  }

  async createSpace(input: {
    name: string;
    slug: string;
    description?: string;
  }): Promise<SpaceDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!isValidSlug(input.slug)) {
      throw new KbInvalidError('slug must be lowercase letters, digits and hyphens (1-64 chars)');
    }
    await this.quotas.assertCanAdd('kb_spaces');
    const existing = await ctx.db
      .select({ id: schema.kbSpaces.id })
      .from(schema.kbSpaces)
      .where(and(eq(schema.kbSpaces.orgId, actor.orgId), eq(schema.kbSpaces.slug, input.slug)))
      .limit(1);
    if (existing[0]) {
      throw new KbInvalidError(`a space with slug "${input.slug}" already exists`);
    }
    const [row] = await ctx.db
      .insert(schema.kbSpaces)
      .values({
        orgId: actor.orgId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
      })
      .returning();
    return toSpaceDto(row!);
  }

  async listDocuments(input: {
    spaceId?: string;
    tag?: string;
    limit?: number;
  }): Promise<DocumentSummary[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const filters = [];
    if (input.spaceId) filters.push(eq(schema.kbDocuments.spaceId, input.spaceId));
    if (input.tag) {
      filters.push(sql`${schema.kbDocuments.tags} @> ${JSON.stringify([input.tag])}::jsonb`);
    }
    const rows = await ctx.db
      .select({
        id: schema.kbDocuments.id,
        spaceId: schema.kbDocuments.spaceId,
        slug: schema.kbDocuments.slug,
        title: schema.kbDocuments.title,
        audiences: schema.kbDocuments.audiences,
        version: schema.kbDocuments.version,
        tags: schema.kbDocuments.tags,
        updatedAt: schema.kbDocuments.updatedAt,
      })
      .from(schema.kbDocuments)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(schema.kbDocuments.updatedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      spaceId: r.spaceId,
      slug: r.slug,
      title: r.title,
      audiences: r.audiences,
      version: r.version,
      tags: r.tags,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async getDocument(id: string): Promise<DocumentDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.kbDocuments)
      .where(eq(schema.kbDocuments.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new KbNotFoundError('document', id);
    return toDocumentDto(row);
  }

  async createDocument(input: {
    spaceId: string;
    title: string;
    body: string;
    audiences?: readonly string[];
    tags?: string[];
    slug?: string;
  }): Promise<DocumentDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const space = await this.loadSpace(input.spaceId);
    await this.quotas.assertCanAdd('kb_documents');
    if (input.slug !== undefined && !isValidSlug(input.slug)) {
      throw new KbInvalidError(`slug must match [a-z0-9][a-z0-9-]{0,63}`);
    }
    const audiences = normaliseAudiences(input.audiences);
    const hash = contentHash(input.title, input.body);
    const isSystem = isSystemRuntimeDoc(space.slug, input.slug ?? null);
    const [doc] = await ctx.db
      .insert(schema.kbDocuments)
      .values({
        orgId: actor.orgId,
        spaceId: input.spaceId,
        slug: input.slug ?? null,
        title: input.title,
        body: input.body,
        audiences,
        version: 1,
        contentHash: hash,
        tags: input.tags ?? [],
        isSystem,
        ...stampCreator(actor),
      })
      .returning();
    await this.snapshotVersion(doc!, actor);
    await this.regenerateChunks(doc!);
    await this.webhooks.emit({
      type: 'kb.document.created',
      payload: {
        spaceId: doc!.spaceId,
        documentId: doc!.id,
        slug: doc!.slug,
        version: doc!.version,
      },
    });
    return toDocumentDto(doc!);
  }

  async getDocumentBySlug(
    spaceSlug: string,
    docSlug: string,
  ): Promise<DocumentDto | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ doc: schema.kbDocuments })
      .from(schema.kbDocuments)
      .innerJoin(schema.kbSpaces, eq(schema.kbSpaces.id, schema.kbDocuments.spaceId))
      .where(and(eq(schema.kbSpaces.slug, spaceSlug), eq(schema.kbDocuments.slug, docSlug)))
      .limit(1);
    const row = rows[0];
    return row ? toDocumentDto(row.doc) : null;
  }

  async updateDocument(input: {
    id: string;
    ifVersion: number;
    title?: string;
    body?: string;
    audiences?: readonly string[];
    tags?: string[];
  }): Promise<DocumentDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const existing = await this.loadForUpdate(input.id);
    if (existing.version !== input.ifVersion) {
      throw new KbConflictError(existing.version, input.ifVersion);
    }
    const newTitle = input.title ?? existing.title;
    const newBody = input.body ?? existing.body;
    const newAudiences = input.audiences === undefined
      ? existing.audiences
      : normaliseAudiences(input.audiences);
    const newTags = input.tags ?? existing.tags;
    const newHash = contentHash(newTitle, newBody);
    const contentChanged = newHash !== existing.contentHash;

    const [updated] = await ctx.db
      .update(schema.kbDocuments)
      .set({
        title: newTitle,
        body: newBody,
        audiences: newAudiences,
        tags: newTags,
        contentHash: newHash,
        version: existing.version + 1,
        updatedAt: new Date(),
        ...stampUpdater(actor),
      })
      .where(eq(schema.kbDocuments.id, input.id))
      .returning();

    await this.snapshotVersion(updated!, actor);
    if (contentChanged) {
      await this.regenerateChunks(updated!);
    }
    await this.webhooks.emit({
      type: 'kb.document.updated',
      payload: {
        spaceId: updated!.spaceId,
        documentId: updated!.id,
        slug: updated!.slug,
        version: updated!.version,
      },
    });
    return toDocumentDto(updated!);
  }

  async deleteDocument(input: { id: string; ifVersion: number }): Promise<{ deleted: true }> {
    const existing = await this.loadForUpdate(input.id);
    if (existing.isSystem) {
      throw new KbInvalidError(
        `document ${input.id} is system-managed and cannot be deleted (content can still be edited via kb_update_document)`,
      );
    }
    if (existing.version !== input.ifVersion) {
      throw new KbConflictError(existing.version, input.ifVersion);
    }
    return this.removeDocument(existing, { emitCandidateDismissed: true });
  }

  private async removeDocument(
    existing: typeof schema.kbDocuments.$inferSelect,
    opts: { emitCandidateDismissed: boolean; reason?: string },
  ): Promise<{ deleted: true }> {
    const ctx = getCurrentContext();
    await ctx.db.delete(schema.kbDocuments).where(eq(schema.kbDocuments.id, existing.id));
    await this.webhooks.emit({
      type: 'kb.document.deleted',
      payload: {
        spaceId: existing.spaceId,
        documentId: existing.id,
        slug: existing.slug,
      },
    });
    if (opts.emitCandidateDismissed && existing.tags.includes('candidate')) {
      const refs = extractCandidateRefs(existing.tags);
      await this.recordCurationDecision({
        sourceConversationId: refs.sourceConversationId,
        sourceMessageId: refs.sourceMessageId,
        candidateDocumentId: existing.id,
        title: existing.title,
        outcome: 'dismissed',
        reason: opts.reason ?? null,
        publishedDocumentId: null,
      });
      await this.webhooks.emit({
        type: 'kb.curation_candidate.dismissed',
        payload: {
          candidateDocumentId: existing.id,
          title: existing.title,
          reason: opts.reason ?? null,
          ...refs,
        },
      });
    }
    return { deleted: true };
  }

  private async recordCurationDecision(input: {
    sourceConversationId: string | null;
    sourceMessageId?: string | null;
    candidateDocumentId: string;
    title: string;
    outcome: CurationOutcome;
    reason: string | null;
    publishedDocumentId: string | null;
  }): Promise<void> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    await ctx.db.insert(schema.kbCurationDecisions).values({
      orgId: actor.orgId,
      sourceConversationId: input.sourceConversationId,
      sourceMessageId: input.sourceMessageId ?? null,
      candidateDocumentId: input.candidateDocumentId,
      title: input.title,
      outcome: input.outcome,
      reason: input.reason,
      publishedDocumentId: input.publishedDocumentId,
      decidedByActorType: actor.type === 'user' ? 'user' : 'agent',
      decidedByActorId: actor.id,
      decidedAt: new Date(),
    });
  }

  async dismissCurationCandidate(input: {
    id: string;
    ifVersion: number;
    reason?: string;
  }): Promise<{ dismissed: true; id: string; sourceConversationId: string | null }> {
    const existing = await this.loadForUpdate(input.id);
    if (!existing.tags.includes('candidate')) {
      throw new KbInvalidError(
        `document ${input.id} is not a curation candidate (missing 'candidate' tag)`,
      );
    }
    if (existing.version !== input.ifVersion) {
      throw new KbConflictError(existing.version, input.ifVersion);
    }
    await this.removeDocument(existing, {
      emitCandidateDismissed: true,
      reason: input.reason,
    });
    return {
      dismissed: true,
      id: input.id,
      sourceConversationId: extractCandidateRefs(existing.tags).sourceConversationId,
    };
  }

  async listCurationDecisions(input?: {
    outcome?: CurationOutcome;
    sourceConversationId?: string;
    limit?: number;
  }): Promise<CurationDecisionDto[]> {
    const ctx = getCurrentContext();
    const filters = [];
    if (input?.outcome) filters.push(eq(schema.kbCurationDecisions.outcome, input.outcome));
    if (input?.sourceConversationId) {
      filters.push(
        eq(schema.kbCurationDecisions.sourceConversationId, input.sourceConversationId),
      );
    }
    const rows = await ctx.db
      .select()
      .from(schema.kbCurationDecisions)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(schema.kbCurationDecisions.decidedAt))
      .limit(clampLimit(input?.limit, 50, 200));
    return rows.map(toCurationDecisionDto);
  }

  async listCurationCandidates(limit?: number): Promise<CurationCandidateSummary[]> {
    const items = await this.listDocuments({ tag: 'candidate', limit: limit ?? 200 });
    const withRefs = items.map((d) => ({ ...d, ...extractCandidateRefs(d.tags) }));
    const revised = await this.loadRevisedDocuments(
      withRefs.map((c) => c.revisesDocumentId).filter((id): id is string => id !== null),
    );
    return withRefs.map((c) => ({ ...c, ...revisedRefOf(revised, c.revisesDocumentId) }));
  }

  async getCurationCandidate(id: string): Promise<CurationCandidateDto> {
    const doc = await this.getDocument(id);
    if (!doc.tags.includes('candidate')) {
      throw new KbInvalidError(`document ${id} is not a curation candidate`);
    }
    const refs = extractCandidateRefs(doc.tags);
    const revised = await this.loadRevisedDocuments(
      refs.revisesDocumentId ? [refs.revisesDocumentId] : [],
    );
    const hit = refs.revisesDocumentId ? revised.get(refs.revisesDocumentId) : undefined;
    return {
      ...doc,
      ...refs,
      ...revisedRefOf(revised, refs.revisesDocumentId),
      revisesDocumentBody: hit?.body ?? null,
    };
  }

  private async loadRevisedDocuments(
    ids: string[],
  ): Promise<Map<string, { title: string; version: number; body: string }>> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return new Map();
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        id: schema.kbDocuments.id,
        title: schema.kbDocuments.title,
        version: schema.kbDocuments.version,
        body: schema.kbDocuments.body,
      })
      .from(schema.kbDocuments)
      .where(inArray(schema.kbDocuments.id, unique));
    return new Map(
      rows.map((r) => [r.id, { title: r.title, version: r.version, body: r.body }]),
    );
  }

  async proposeCurationCandidate(input: {
    subject: string;
    draftBody: string;
    sourceConversationId?: string;
    sourceMessageIds?: string[];
    proposedTargetSpaceSlug?: string;
  }): Promise<DocumentDto> {
    const sourceMessageId = input.sourceMessageIds?.[0];
    if (input.sourceConversationId) {
      await this.assertSourceNotDecided(input.sourceConversationId, sourceMessageId);
    }
    const space = await this.ensureCurationInboxSpace();
    const doc = await this.createDocument({
      spaceId: space.id,
      title: input.subject,
      body: input.draftBody,
      audiences: ['admin'],
      tags: dedupeTags([
        'curation',
        'candidate',
        ...(input.sourceConversationId ? [`source:${input.sourceConversationId}`] : []),
        ...(sourceMessageId ? [`source-msg:${sourceMessageId}`] : []),
        ...(input.proposedTargetSpaceSlug ? [`target:${input.proposedTargetSpaceSlug}`] : []),
      ]),
    });
    await this.webhooks.emit({
      type: 'kb.curation_candidate.proposed',
      payload: {
        candidateDocumentId: doc.id,
        title: doc.title,
        proposedTargetSpaceSlug: input.proposedTargetSpaceSlug ?? null,
        sourceConversationId: input.sourceConversationId ?? null,
        spaceId: doc.spaceId,
      },
    });
    return doc;
  }

  async proposeCurationRevision(input: {
    revisesDocumentId: string;
    draftBody: string;
    subject?: string;
    sourceConversationId?: string;
    sourceMessageId?: string;
  }): Promise<DocumentDto> {
    const revised = await this.loadForUpdate(input.revisesDocumentId);
    if (revised.tags.includes('candidate')) {
      throw new KbInvalidError(
        `document ${input.revisesDocumentId} is itself a curation candidate — revise the published document instead`,
      );
    }
    if (revised.isSystem) {
      throw new KbInvalidError(
        `document ${input.revisesDocumentId} is agent-runtime configuration, not reference material — edit it directly with kb_update_document`,
      );
    }
    if (input.sourceConversationId) {
      await this.assertSourceNotDecided(input.sourceConversationId, input.sourceMessageId);
    }
    const space = await this.ensureCurationInboxSpace();
    const doc = await this.createDocument({
      spaceId: space.id,
      title: input.subject ?? revised.title,
      body: input.draftBody,
      audiences: ['admin'],
      tags: dedupeTags([
        'curation',
        'candidate',
        'revision',
        `revises:${revised.id}`,
        ...(input.sourceConversationId ? [`source:${input.sourceConversationId}`] : []),
        ...(input.sourceMessageId ? [`source-msg:${input.sourceMessageId}`] : []),
      ]),
    });
    await this.webhooks.emit({
      type: 'kb.curation_candidate.proposed',
      payload: {
        candidateDocumentId: doc.id,
        title: doc.title,
        proposedTargetSpaceSlug: null,
        sourceConversationId: input.sourceConversationId ?? null,
        revisesDocumentId: revised.id,
        spaceId: doc.spaceId,
      },
    });
    return doc;
  }

  async publishCurationCandidate(input: {
    candidateDocumentId: string;
    targetSpaceSlug: string;
    ifVersion: number;
    audiences?: readonly string[];
  }): Promise<DocumentDto> {
    const ctx = getCurrentContext();
    const candidate = await this.loadForUpdate(input.candidateDocumentId);
    if (!candidate.tags.includes('candidate')) {
      throw new KbInvalidError(
        `document ${input.candidateDocumentId} is not a curation candidate (missing 'candidate' tag)`,
      );
    }
    if (candidate.tags.includes('revision')) {
      throw new KbInvalidError(
        `candidate ${input.candidateDocumentId} proposes a revision to an existing document — publish it with kb_publish_curation_revision, which writes a new version of that document instead of creating a second one`,
      );
    }
    if (candidate.version !== input.ifVersion) {
      throw new KbConflictError(candidate.version, input.ifVersion);
    }
    const targetSpaceRows = await ctx.db
      .select()
      .from(schema.kbSpaces)
      .where(eq(schema.kbSpaces.slug, input.targetSpaceSlug))
      .limit(1);
    let targetSpace = targetSpaceRows[0];
    if (!targetSpace) {
      if (!isValidSlug(input.targetSpaceSlug)) {
        throw new KbInvalidError(
          `cannot auto-create space: slug "${input.targetSpaceSlug}" must be lowercase letters, digits and hyphens (1-64 chars)`,
        );
      }
      const created = await this.createSpace({
        name: humaniseSlug(input.targetSpaceSlug),
        slug: input.targetSpaceSlug,
        description: 'Auto-created from KB curation.',
      });
      const rows = await ctx.db
        .select()
        .from(schema.kbSpaces)
        .where(eq(schema.kbSpaces.id, created.id))
        .limit(1);
      targetSpace = rows[0];
      if (!targetSpace) throw new KbInvalidError('failed to auto-create target space');
    }
    const audiences = input.audiences
      ? normaliseAudiences(input.audiences)
      : (['admin', 'self_service'] as Audience[]);
    const carriedTags = stripCandidateTags(candidate.tags);
    const published = await this.createDocument({
      spaceId: targetSpace.id,
      title: candidate.title,
      body: candidate.body,
      audiences,
      tags: carriedTags,
    });
    await this.removeDocument(candidate, { emitCandidateDismissed: false });
    await this.recordCurationDecision({
      sourceConversationId: extractCandidateRefs(candidate.tags).sourceConversationId,
      candidateDocumentId: candidate.id,
      title: candidate.title,
      outcome: 'published',
      reason: null,
      publishedDocumentId: published.id,
    });
    await this.webhooks.emit({
      type: 'kb.curation_candidate.published',
      payload: {
        candidateDocumentId: candidate.id,
        publishedDocumentId: published.id,
        targetSpaceSlug: input.targetSpaceSlug,
        targetSpaceId: targetSpace.id,
        title: candidate.title,
      },
    });
    return published;
  }

  async publishCurationRevision(input: {
    candidateDocumentId: string;
    ifCandidateVersion: number;
    ifDocumentVersion: number;
  }): Promise<DocumentDto> {
    const candidate = await this.loadForUpdate(input.candidateDocumentId);
    if (!candidate.tags.includes('candidate')) {
      throw new KbInvalidError(
        `document ${input.candidateDocumentId} is not a curation candidate (missing 'candidate' tag)`,
      );
    }
    const refs = extractCandidateRefs(candidate.tags);
    if (!refs.revisesDocumentId) {
      throw new KbInvalidError(
        `candidate ${input.candidateDocumentId} does not revise an existing document — publish it with kb_publish_curation_candidate and a target space`,
      );
    }
    if (candidate.version !== input.ifCandidateVersion) {
      throw new KbConflictError(candidate.version, input.ifCandidateVersion);
    }
    const revised = await this.loadForUpdate(refs.revisesDocumentId);
    if (revised.version !== input.ifDocumentVersion) {
      throw new KbConflictError(revised.version, input.ifDocumentVersion);
    }
    const published = await this.updateDocument({
      id: revised.id,
      ifVersion: input.ifDocumentVersion,
      body: candidate.body,
    });
    await this.removeDocument(candidate, { emitCandidateDismissed: false });
    await this.recordCurationDecision({
      sourceConversationId: refs.sourceConversationId,
      sourceMessageId: refs.sourceMessageId,
      candidateDocumentId: candidate.id,
      title: candidate.title,
      outcome: 'published',
      reason: null,
      publishedDocumentId: published.id,
    });
    await this.webhooks.emit({
      type: 'kb.curation_candidate.published',
      payload: {
        candidateDocumentId: candidate.id,
        publishedDocumentId: published.id,
        revisedDocumentId: published.id,
        revisedToVersion: published.version,
        targetSpaceId: published.spaceId,
        title: published.title,
      },
    });
    return published;
  }

  private async assertSourceNotDecided(
    sourceConversationId: string,
    sourceMessageId?: string,
  ): Promise<void> {
    const ctx = getCurrentContext();
    const [decided] = await ctx.db
      .select({
        outcome: schema.kbCurationDecisions.outcome,
        decidedAt: schema.kbCurationDecisions.decidedAt,
        sourceMessageId: schema.kbCurationDecisions.sourceMessageId,
      })
      .from(schema.kbCurationDecisions)
      .where(
        and(
          eq(schema.kbCurationDecisions.sourceConversationId, sourceConversationId),
          sourceMessageId
            ? or(
                isNull(schema.kbCurationDecisions.sourceMessageId),
                eq(schema.kbCurationDecisions.sourceMessageId, sourceMessageId),
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.kbCurationDecisions.decidedAt))
      .limit(1);
    if (!decided) return;
    throw new KbCurationDecidedError(
      sourceConversationId,
      decided.outcome,
      decided.decidedAt.toISOString(),
      decided.sourceMessageId,
    );
  }

  private async ensureCurationInboxSpace(): Promise<SpaceDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.kbSpaces)
      .where(eq(schema.kbSpaces.slug, CURATION_INBOX_SLUG))
      .limit(1);
    const existing = rows[0];
    if (existing) return toSpaceDto(existing);
    return this.createSpace({
      name: 'Curation inbox',
      slug: CURATION_INBOX_SLUG,
      description:
        'Drafted KB-document candidates from resolved-handover conversations. Review with kb_list_documents tag=candidate, then promote with kb_publish_curation_candidate.',
    });
  }

  async listVersions(documentId: string): Promise<VersionDto[]> {
    const ctx = getCurrentContext();
    await this.assertDocumentExists(documentId);
    const rows = await ctx.db
      .select()
      .from(schema.kbDocumentVersions)
      .where(eq(schema.kbDocumentVersions.documentId, documentId))
      .orderBy(desc(schema.kbDocumentVersions.version));
    return rows.map(toVersionDto);
  }

  async restoreVersion(input: {
    documentId: string;
    version: number;
    ifVersion: number;
  }): Promise<DocumentDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const existing = await this.loadForUpdate(input.documentId);
    if (existing.version !== input.ifVersion) {
      throw new KbConflictError(existing.version, input.ifVersion);
    }
    const target = await ctx.db
      .select()
      .from(schema.kbDocumentVersions)
      .where(
        and(
          eq(schema.kbDocumentVersions.documentId, input.documentId),
          eq(schema.kbDocumentVersions.version, input.version),
        ),
      )
      .limit(1);
    const snap = target[0];
    if (!snap) throw new KbNotFoundError('version', `${input.documentId}@${input.version}`);

    const newHash = contentHash(snap.title, snap.body);
    const [updated] = await ctx.db
      .update(schema.kbDocuments)
      .set({
        title: snap.title,
        body: snap.body,
        audiences: snap.audiences,
        tags: snap.tags,
        contentHash: newHash,
        version: existing.version + 1,
        updatedAt: new Date(),
        ...stampUpdater(actor),
      })
      .where(eq(schema.kbDocuments.id, input.documentId))
      .returning();
    await this.snapshotVersion(updated!, actor);
    await this.regenerateChunks(updated!);
    await this.webhooks.emit({
      type: 'kb.document.updated',
      payload: {
        spaceId: updated!.spaceId,
        documentId: updated!.id,
        slug: updated!.slug,
        version: updated!.version,
      },
    });
    return toDocumentDto(updated!);
  }

  async exportKb(): Promise<KbExportData> {
    const ctx = getCurrentContext();
    const [spaces, documents] = await Promise.all([
      ctx.db.select().from(schema.kbSpaces).orderBy(asc(schema.kbSpaces.createdAt)),
      ctx.db
        .select()
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.isSystem, false))
        .orderBy(asc(schema.kbDocuments.createdAt)),
    ]);
    return {
      spaces: spaces.map((s) => ({ id: s.id, name: s.name, slug: s.slug, description: s.description })),
      documents: documents.map((d) => ({
        id: d.id,
        spaceId: d.spaceId,
        slug: d.slug,
        title: d.title,
        body: d.body,
        audiences: d.audiences,
        tags: d.tags,
      })),
    };
  }

  async importKb(data: KbExportData, priorIdMap: IdMap = {}): Promise<ImportResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = newImportResult();
    result.idMap = { ...priorIdMap };

    for (const space of data.spaces) {
      const existing = await ctx.db
        .select({ id: schema.kbSpaces.id })
        .from(schema.kbSpaces)
        .where(and(eq(schema.kbSpaces.orgId, actor.orgId), eq(schema.kbSpaces.slug, space.slug)))
        .limit(1);
      if (existing[0]) {
        result.idMap[space.id] = existing[0].id;
        result.skipped++;
      } else {
        const created = await this.createSpace({
          name: space.name,
          slug: space.slug,
          description: space.description ?? undefined,
        });
        result.idMap[space.id] = created.id;
        result.created++;
      }
    }

    for (const doc of data.documents) {
      const targetSpaceId = resolveId(result.idMap, doc.spaceId);
      if (!targetSpaceId) {
        result.warnings.push(
          `document "${doc.title}" skipped: source space ${doc.spaceId} was not part of this import`,
        );
        result.skipped++;
        continue;
      }
      const existing = await this.findDocumentForImport(targetSpaceId, doc.slug, doc.title);
      if (existing) {
        result.idMap[doc.id] = existing.id;
        if (existing.title !== doc.title || existing.body !== doc.body) {
          await this.updateDocument({
            id: existing.id,
            ifVersion: existing.version,
            title: doc.title,
            body: doc.body,
            audiences: doc.audiences,
            tags: doc.tags,
          });
          result.updated++;
        } else {
          result.skipped++;
        }
      } else {
        const createdDoc = await this.createDocument({
          spaceId: targetSpaceId,
          title: doc.title,
          body: doc.body,
          audiences: doc.audiences,
          tags: doc.tags,
          slug: doc.slug ?? undefined,
        });
        result.idMap[doc.id] = createdDoc.id;
        result.created++;
      }
    }
    return result;
  }

  private async findDocumentForImport(
    spaceId: string,
    slug: string | null,
    title: string,
  ): Promise<{ id: string; title: string; body: string; version: number } | null> {
    const ctx = getCurrentContext();
    const cond = slug
      ? and(eq(schema.kbDocuments.spaceId, spaceId), eq(schema.kbDocuments.slug, slug))
      : and(
          eq(schema.kbDocuments.spaceId, spaceId),
          eq(schema.kbDocuments.title, title),
          isNull(schema.kbDocuments.slug),
        );
    const rows = await ctx.db
      .select({
        id: schema.kbDocuments.id,
        title: schema.kbDocuments.title,
        body: schema.kbDocuments.body,
        version: schema.kbDocuments.version,
      })
      .from(schema.kbDocuments)
      .where(cond)
      .limit(1);
    return rows[0] ?? null;
  }

  private async loadSpace(spaceId: string): Promise<typeof schema.kbSpaces.$inferSelect> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.kbSpaces)
      .where(eq(schema.kbSpaces.id, spaceId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new KbNotFoundError('space', spaceId);
    return row;
  }

  private async assertDocumentExists(documentId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.kbDocuments.id })
      .from(schema.kbDocuments)
      .where(eq(schema.kbDocuments.id, documentId))
      .limit(1);
    if (!rows[0]) throw new KbNotFoundError('document', documentId);
  }

  private async loadForUpdate(id: string): Promise<typeof schema.kbDocuments.$inferSelect> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.kbDocuments)
      .where(eq(schema.kbDocuments.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new KbNotFoundError('document', id);
    return row;
  }

  private async snapshotVersion(
    doc: typeof schema.kbDocuments.$inferSelect,
    actor: ActorIdentity,
  ): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db.insert(schema.kbDocumentVersions).values({
      orgId: doc.orgId,
      documentId: doc.id,
      version: doc.version,
      title: doc.title,
      body: doc.body,
      audiences: doc.audiences,
      tags: doc.tags,
      createdByType: actorTypeToCreatorTag(actor),
      createdById: actor.id,
    });
  }

  private async regenerateChunks(doc: typeof schema.kbDocuments.$inferSelect): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db.delete(schema.kbDocumentChunks).where(eq(schema.kbDocumentChunks.documentId, doc.id));
    const chunks = chunkDocument(`${doc.title}\n\n${doc.body}`);
    if (chunks.length === 0) return;

    const provider = this.embeddings.get();
    let vectors: (number[] | null)[];
    try {
      vectors = await provider.embed(chunks.map((c) => c.content));
    } catch {
      vectors = chunks.map(() => null);
    }
    await ctx.db.insert(schema.kbDocumentChunks).values(
      chunks.map((c, i) => ({
        orgId: doc.orgId,
        documentId: doc.id,
        chunkIndex: c.index,
        content: c.content,
        tokenCount: c.tokenCount,
        embedding: vectors[i] ?? null,
      })),
    );
  }
}

function toSpaceDto(row: typeof schema.kbSpaces.$inferSelect): SpaceDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDocumentDto(row: typeof schema.kbDocuments.$inferSelect): DocumentDto {
  return {
    id: row.id,
    spaceId: row.spaceId,
    slug: row.slug,
    title: row.title,
    body: row.body,
    audiences: row.audiences,
    version: row.version,
    tags: row.tags,
    isSystem: row.isSystem,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toVersionDto(row: typeof schema.kbDocumentVersions.$inferSelect): VersionDto {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    title: row.title,
    body: row.body,
    audiences: row.audiences,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
  };
}

function toCurationDecisionDto(
  row: typeof schema.kbCurationDecisions.$inferSelect,
): CurationDecisionDto {
  return {
    id: row.id,
    sourceConversationId: row.sourceConversationId,
    sourceMessageId: row.sourceMessageId,
    candidateDocumentId: row.candidateDocumentId,
    title: row.title,
    outcome: row.outcome as CurationOutcome,
    reason: row.reason,
    publishedDocumentId: row.publishedDocumentId,
    decidedByActorType: row.decidedByActorType,
    decidedByActorId: row.decidedByActorId,
    decidedAt: row.decidedAt.toISOString(),
  };
}

function actorTypeToCreatorTag(actor: ActorIdentity): 'agent' | 'user' {
  return actor.type === 'user' ? 'user' : 'agent';
}

function stampCreator(actor: ActorIdentity): {
  createdByType: 'agent' | 'user';
  createdById: string;
  updatedByType: 'agent' | 'user';
  updatedById: string;
} {
  const tag = actorTypeToCreatorTag(actor);
  return { createdByType: tag, createdById: actor.id, updatedByType: tag, updatedById: actor.id };
}

function stampUpdater(actor: ActorIdentity): {
  updatedByType: 'agent' | 'user';
  updatedById: string;
} {
  const tag = actorTypeToCreatorTag(actor);
  return { updatedByType: tag, updatedById: actor.id };
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

function humaniseSlug(slug: string): string {
  return slug
    .split('-')
    .filter((p) => p.length > 0)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(' ');
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}

export const CURATION_INBOX_SLUG = 'kb-curation-inbox';

function extractCandidateRefs(tags: string[]): {
  proposedTargetSpaceSlug: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  revisesDocumentId: string | null;
} {
  let proposedTargetSpaceSlug: string | null = null;
  let sourceConversationId: string | null = null;
  let sourceMessageId: string | null = null;
  let revisesDocumentId: string | null = null;
  for (const t of tags) {
    if (t.startsWith('target:') && !proposedTargetSpaceSlug) {
      proposedTargetSpaceSlug = t.slice('target:'.length);
    } else if (t.startsWith('source-msg:') && !sourceMessageId) {
      sourceMessageId = t.slice('source-msg:'.length);
    } else if (t.startsWith('source:') && !sourceConversationId) {
      sourceConversationId = t.slice('source:'.length);
    } else if (t.startsWith('revises:') && !revisesDocumentId) {
      revisesDocumentId = t.slice('revises:'.length);
    }
  }
  return { proposedTargetSpaceSlug, sourceConversationId, sourceMessageId, revisesDocumentId };
}

function dedupeTags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

function revisedRefOf(
  revised: Map<string, { title: string; version: number; body: string }>,
  revisesDocumentId: string | null,
): RevisedDocumentRef {
  const hit = revisesDocumentId ? revised.get(revisesDocumentId) : undefined;
  return {
    revisesDocumentTitle: hit?.title ?? null,
    revisesDocumentVersion: hit?.version ?? null,
  };
}

function stripCandidateTags(tags: string[]): string[] {
  return tags.filter(
    (t) =>
      t !== 'curation' &&
      t !== 'candidate' &&
      t !== 'revision' &&
      !t.startsWith('source:') &&
      !t.startsWith('source-msg:') &&
      !t.startsWith('target:') &&
      !t.startsWith('revises:'),
  );
}
