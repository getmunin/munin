import { Injectable, Inject } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
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

export interface CurationCandidateSummary extends DocumentSummary {
  proposedTargetSpaceSlug: string | null;
  sourceConversationId: string | null;
}

export interface CurationCandidateDto extends DocumentDto {
  proposedTargetSpaceSlug: string | null;
  sourceConversationId: string | null;
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

  // ─── Spaces ─────────────────────────────────────────────────────────────

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

  // ─── Documents ──────────────────────────────────────────────────────────

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
    const ctx = getCurrentContext();
    const existing = await this.loadForUpdate(input.id);
    if (existing.isSystem) {
      throw new KbInvalidError(
        `document ${input.id} is system-managed and cannot be deleted (content can still be edited via kb_update_document)`,
      );
    }
    if (existing.version !== input.ifVersion) {
      throw new KbConflictError(existing.version, input.ifVersion);
    }
    await ctx.db.delete(schema.kbDocuments).where(eq(schema.kbDocuments.id, input.id));
    await this.webhooks.emit({
      type: 'kb.document.deleted',
      payload: {
        spaceId: existing.spaceId,
        documentId: existing.id,
        slug: existing.slug,
      },
    });
    return { deleted: true };
  }

  // ─── Curation ───────────────────────────────────────────────────────────

  async listCurationCandidates(limit?: number): Promise<CurationCandidateSummary[]> {
    const items = await this.listDocuments({ tag: 'candidate', limit: limit ?? 200 });
    return items.map((d) => ({ ...d, ...extractCandidateRefs(d.tags) }));
  }

  async getCurationCandidate(id: string): Promise<CurationCandidateDto> {
    const doc = await this.getDocument(id);
    if (!doc.tags.includes('candidate')) {
      throw new KbInvalidError(`document ${id} is not a curation candidate`);
    }
    return { ...doc, ...extractCandidateRefs(doc.tags) };
  }

  async proposeCurationCandidate(input: {
    subject: string;
    draftBody: string;
    sourceConversationId?: string;
    sourceMessageIds?: string[];
    proposedTargetSpaceSlug?: string;
  }): Promise<DocumentDto> {
    const space = await this.ensureCurationInboxSpace();
    return this.createDocument({
      spaceId: space.id,
      title: input.subject,
      body: input.draftBody,
      audiences: ['admin'],
      tags: dedupeTags([
        'curation',
        'candidate',
        ...(input.sourceConversationId ? [`source:${input.sourceConversationId}`] : []),
        ...(input.proposedTargetSpaceSlug ? [`target:${input.proposedTargetSpaceSlug}`] : []),
      ]),
    });
  }

  async publishCurationCandidate(input: {
    candidateDocumentId: string;
    targetSpaceSlug: string;
    audiences?: readonly string[];
  }): Promise<DocumentDto> {
    const ctx = getCurrentContext();
    const candidate = await this.loadForUpdate(input.candidateDocumentId);
    if (!candidate.tags.includes('candidate')) {
      throw new KbInvalidError(
        `document ${input.candidateDocumentId} is not a curation candidate (missing 'candidate' tag)`,
      );
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
    const carriedTags = candidate.tags.filter(
      (t) => t !== 'curation' && t !== 'candidate' && !t.startsWith('source:') && !t.startsWith('target:'),
    );
    const published = await this.createDocument({
      spaceId: targetSpace.id,
      title: candidate.title,
      body: candidate.body,
      audiences,
      tags: carriedTags,
    });
    await this.deleteDocument({ id: candidate.id, ifVersion: candidate.version });
    return published;
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

  // ─── Versions ───────────────────────────────────────────────────────────

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

  // ─── Transfer (import / export) ──────────────────────────────────────────

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

  // ─── Internals ──────────────────────────────────────────────────────────

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
      // Embedding failure shouldn't block the write — leave vectors null and
      // let FTS carry search until a re-index repairs them.
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

// ─── DTO mappers / helpers ─────────────────────────────────────────────────

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
} {
  let proposedTargetSpaceSlug: string | null = null;
  let sourceConversationId: string | null = null;
  for (const t of tags) {
    if (t.startsWith('target:') && !proposedTargetSpaceSlug) {
      proposedTargetSpaceSlug = t.slice('target:'.length);
    } else if (t.startsWith('source:') && !sourceConversationId) {
      sourceConversationId = t.slice('source:'.length);
    }
  }
  return { proposedTargetSpaceSlug, sourceConversationId };
}

function dedupeTags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}
