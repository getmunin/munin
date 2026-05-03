import { Injectable, Inject } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { chunkDocument, contentHash, getCurrentContext, WebhookDispatcher } from '@getmunin/core';
import type { ActorIdentity, Audience } from '@getmunin/core';
import { EmbeddingProviderHolder } from './embedding.provider.js';
import { QuotasService } from '../../common/quotas/quotas.service.js';

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
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  spaceId: string;
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

@Injectable()
export class KbService {
  constructor(
    @Inject(EmbeddingProviderHolder) private readonly embeddings: EmbeddingProviderHolder,
    @Inject(QuotasService) private readonly quotas: QuotasService,
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
    await this.assertSpaceExists(input.spaceId);
    await this.quotas.assertCanAdd('kb_documents');
    if (input.slug !== undefined && !isValidSlug(input.slug)) {
      throw new KbInvalidError(`slug must match [a-z0-9][a-z0-9-]{0,63}`);
    }
    const audiences = normaliseAudiences(input.audiences);
    const hash = contentHash(input.title, input.body);
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

  // ─── Internals ──────────────────────────────────────────────────────────

  private async assertSpaceExists(spaceId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.kbSpaces.id })
      .from(schema.kbSpaces)
      .where(eq(schema.kbSpaces.id, spaceId))
      .limit(1);
    if (!rows[0]) throw new KbNotFoundError('space', spaceId);
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

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}
