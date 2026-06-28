import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  contentHash,
  describeError,
  getCurrentContext,
  safeFetch,
  SsrfBlockedError,
  WebhookDispatcher,
  type AssetStorage,
} from '@getmunin/core';
import { QUOTAS_SERVICE, type QuotasService } from '../../common/quotas/quotas.service.ts';
import { STORAGE } from '../../common/storage/storage.token.ts';
import {
  applyAssetExpansion,
  buildInlineAssetSidecar,
  buildSearchText,
  collectAssetIds,
  extractAssetReferences,
  extractReferences,
  FIELD_TYPES,
  projectData,
  remapInlineAssetUris,
  rewriteInlineAssets,
  validateEntryData,
  type AssetSummary,
  type FieldDef,
} from './cms.fields.ts';
import { loadAssetMap } from './cms.asset-loader.ts';
import { EmbeddingProviderHolder } from '../kb/embedding.provider.ts';
import { newImportResult, resolveId } from '../../common/transfer/transfer.helpers.ts';
import type { IdMap, ImportResult } from '../../common/transfer/transfer.types.ts';

export class CmsInvalidError extends Error {
  readonly code = 'cms_invalid';
  readonly fieldErrors?: ReadonlyArray<{ field: string; message: string }>;
  constructor(
    message: string,
    opts?: { fieldErrors?: ReadonlyArray<{ field: string; message: string }> },
  ) {
    super(`cms_invalid: ${message}`);
    this.fieldErrors = opts?.fieldErrors;
  }
}

export class CmsConflictError extends Error {
  readonly code = 'cms_version_conflict';
  constructor(public readonly currentVersion: number, public readonly providedVersion: number) {
    super(`cms_version_conflict: entry is at version ${currentVersion}, write expected ${providedVersion}`);
  }
}

export const ENTRY_STATUSES = ['draft', 'published', 'scheduled', 'archived'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

// ─── DTOs ───────────────────────────────────────────────────────────────

export interface CollectionDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  fields: FieldDef[];
  localized: boolean;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EntryDto {
  id: string;
  collectionId: string;
  collectionSlug: string;
  slug: string;
  locale: string;
  status: EntryStatus;
  data: Record<string, unknown>;
  assets?: Record<string, AssetSummary>;
  version: number;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CmsDraftEntrySummary {
  id: string;
  collectionId: string;
  collectionSlug: string;
  collectionName: string;
  slug: string;
  locale: string;
  title: string | null;
  titleFieldName: string | null;
  wordCount: number | null;
  version: number;
  updatedAt: string;
}

export interface VersionDto {
  id: string;
  entryId: string;
  version: number;
  status: EntryStatus;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface AssetDto {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  storageProvider: string;
  storageKey: string;
  publicUrl: string;
  altText: string | null;
  metadata: Record<string, unknown>;
  uploaded: boolean;
  createdAt: string;
}

export interface AssetUploadHandle extends AssetDto {
  uploadUrl: string;
  uploadMethod: 'PUT' | 'POST';
  uploadFields: Record<string, string>;
  uploadExpiresAt: string;
}

export interface LocaleDto {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  position: number;
}

// ─── Transfer shapes ─────────────────────────────────────────────────────

export interface CmsLocaleExport {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

export interface CmsCollectionExport {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  fields: FieldDef[];
  localized: boolean;
  settings: Record<string, unknown>;
}

export interface CmsEntryExport {
  id: string;
  collectionId: string;
  slug: string;
  locale: string;
  status: EntryStatus;
  data: Record<string, unknown>;
  scheduledAt: string | null;
}

export interface CmsAssetExport {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  storageKey: string;
  altText: string | null;
  metadata: Record<string, unknown>;
  base64Body: string | null;
}

export interface CmsExportData {
  locales: CmsLocaleExport[];
  collections: CmsCollectionExport[];
  entries: CmsEntryExport[];
  assets: CmsAssetExport[];
}

const EXPORT_ASSET_BYTES_MAX = 5 * 1024 * 1024;

@Injectable()
export class CmsService {
  constructor(
    @Inject(QUOTAS_SERVICE) private readonly quotas: QuotasService,
    @Inject(WebhookDispatcher) private readonly webhooks: WebhookDispatcher,
    @Inject(STORAGE) private readonly storage: AssetStorage,
    @Inject(EmbeddingProviderHolder) private readonly embeddings: EmbeddingProviderHolder,
  ) {}

  // ─── Collections ─────────────────────────────────────────────────────

  async listCollections(): Promise<CollectionDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.cmsCollections)
      .orderBy(asc(schema.cmsCollections.name));
    return rows.map(toCollectionDto);
  }

  async getCollection(idOrSlug: string): Promise<CollectionDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const rows = await ctx.db
      .select()
      .from(schema.cmsCollections)
      .where(
        and(
          eq(schema.cmsCollections.orgId, actor.orgId),
          sql`(${schema.cmsCollections.id} = ${idOrSlug} OR ${schema.cmsCollections.slug} = ${idOrSlug})`,
        ),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`cms_not_found: collection ${idOrSlug}`);
    return toCollectionDto(rows[0]);
  }

  async createCollection(input: {
    name: string;
    slug: string;
    description?: string;
    fields: FieldDef[];
    localized?: boolean;
    settings?: Record<string, unknown>;
  }): Promise<CollectionDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!isValidSlug(input.slug)) {
      throw new CmsInvalidError('slug must be lowercase letters, digits and hyphens (1-64 chars)');
    }
    validateFieldsShape(input.fields);

    await this.quotas.assertCanAdd('cms_collections');
    const dup = await ctx.db
      .select({ id: schema.cmsCollections.id })
      .from(schema.cmsCollections)
      .where(
        and(eq(schema.cmsCollections.orgId, actor.orgId), eq(schema.cmsCollections.slug, input.slug)),
      )
      .limit(1);
    if (dup[0]) throw new ConflictException(`cms_slug_conflict: ${input.slug}`);

    const [row] = await ctx.db
      .insert(schema.cmsCollections)
      .values({
        orgId: actor.orgId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        fields: input.fields,
        localized: input.localized ?? false,
        settings: input.settings ?? {},
      })
      .returning();
    await this.webhooks.emit({
      type: 'cms.collection.created',
      payload: { collectionId: row!.id, slug: row!.slug },
    });
    return toCollectionDto(row!);
  }

  async updateCollection(
    idOrSlug: string,
    patch: {
      name?: string;
      description?: string | null;
      fields?: FieldDef[];
      settings?: Record<string, unknown>;
    },
  ): Promise<CollectionDto> {
    const ctx = getCurrentContext();
    const collection = await this.getCollection(idOrSlug);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.fields !== undefined) {
      validateFieldsShape(patch.fields);
      updates.fields = patch.fields;
    }
    if (patch.settings !== undefined) updates.settings = patch.settings;

    const [row] = await ctx.db
      .update(schema.cmsCollections)
      .set(updates)
      .where(eq(schema.cmsCollections.id, collection.id))
      .returning();

    if (patch.fields !== undefined) {
      await this.webhooks.emit({
        type: 'cms.collection.fields_changed',
        payload: { collectionId: collection.id, slug: collection.slug },
      });
    }
    return toCollectionDto(row!);
  }

  async deleteCollection(idOrSlug: string): Promise<{ deleted: true }> {
    const ctx = getCurrentContext();
    const collection = await this.getCollection(idOrSlug);
    await ctx.db.delete(schema.cmsCollections).where(eq(schema.cmsCollections.id, collection.id));
    return { deleted: true };
  }

  // ─── Entries ─────────────────────────────────────────────────────────

  async listEntries(input: {
    collection?: string;
    status?: EntryStatus;
    locale?: string;
    limit?: number;
  }): Promise<EntryDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const filters: SQL[] = [];
    if (input.collection) {
      const col = await this.getCollection(input.collection);
      filters.push(eq(schema.cmsEntries.collectionId, col.id));
    }
    if (input.status) filters.push(eq(schema.cmsEntries.status, input.status));
    if (input.locale) filters.push(eq(schema.cmsEntries.locale, input.locale));

    const rows = await ctx.db
      .select({ entry: schema.cmsEntries, collection: schema.cmsCollections })
      .from(schema.cmsEntries)
      .innerJoin(
        schema.cmsCollections,
        eq(schema.cmsCollections.id, schema.cmsEntries.collectionId),
      )
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(schema.cmsEntries.updatedAt))
      .limit(limit);
    const dtos = rows.map((r) =>
      toEntryDto(r.entry, r.collection.slug, r.collection.fields as FieldDef[]),
    );
    const fieldsByEntryId = new Map<string, FieldDef[]>(
      rows.map((r) => [r.entry.id, r.collection.fields as FieldDef[]]),
    );
    await this.expandAssetsInDtos(ctx.actor!.orgId, dtos, fieldsByEntryId);
    return dtos;
  }

  async listDraftEntries(limit = 50): Promise<CmsDraftEntrySummary[]> {
    const ctx = getCurrentContext();
    const take = clampLimit(limit, 50, 200);
    const rows = await ctx.db
      .select({
        id: schema.cmsEntries.id,
        collectionId: schema.cmsEntries.collectionId,
        slug: schema.cmsEntries.slug,
        locale: schema.cmsEntries.locale,
        data: schema.cmsEntries.data,
        version: schema.cmsEntries.version,
        updatedAt: schema.cmsEntries.updatedAt,
        collectionName: schema.cmsCollections.name,
        collectionSlug: schema.cmsCollections.slug,
        collectionFields: schema.cmsCollections.fields,
      })
      .from(schema.cmsEntries)
      .innerJoin(
        schema.cmsCollections,
        eq(schema.cmsCollections.id, schema.cmsEntries.collectionId),
      )
      .where(eq(schema.cmsEntries.status, 'draft'))
      .orderBy(desc(schema.cmsEntries.updatedAt))
      .limit(take);

    return rows.map((r) => {
      const fields = (r.collectionFields ?? []) as FieldDef[];
      const data = (r.data ?? {});
      const derived = deriveEntryTitle(fields, data);
      return {
        id: r.id,
        collectionId: r.collectionId,
        collectionSlug: r.collectionSlug,
        collectionName: r.collectionName,
        slug: r.slug,
        locale: r.locale,
        title: derived.title ?? r.slug,
        titleFieldName: derived.fieldName,
        wordCount: countWordsInBody(data),
        version: r.version,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async archiveEntry(input: { id: string; ifVersion: number }): Promise<EntryDto> {
    return this.transition(input, 'archived');
  }

  async getEntry(id: string): Promise<EntryDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ entry: schema.cmsEntries, collection: schema.cmsCollections })
      .from(schema.cmsEntries)
      .innerJoin(
        schema.cmsCollections,
        eq(schema.cmsCollections.id, schema.cmsEntries.collectionId),
      )
      .where(eq(schema.cmsEntries.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`cms_not_found: entry ${id}`);
    const fields = rows[0].collection.fields as FieldDef[];
    const dto = toEntryDto(rows[0].entry, rows[0].collection.slug, fields);
    await this.expandAssetsInDtos(
      ctx.actor!.orgId,
      [dto],
      new Map([[rows[0].entry.id, fields]]),
    );
    return dto;
  }

  private async expandAssetsInDtos(
    orgId: string,
    dtos: EntryDto[],
    fieldsByEntryId: Map<string, FieldDef[]>,
  ): Promise<void> {
    const ids = new Set<string>();
    for (const dto of dtos) {
      const fields = fieldsByEntryId.get(dto.id);
      if (!fields) continue;
      for (const id of collectAssetIds(fields, dto.data)) ids.add(id);
    }
    if (ids.size === 0) return;
    const ctx = getCurrentContext();
    const assets = await loadAssetMap(ctx.db, orgId, ids);
    for (const dto of dtos) {
      const fields = fieldsByEntryId.get(dto.id);
      if (!fields) continue;
      dto.data = applyAssetExpansion(fields, dto.data, assets);
      const sidecar = buildInlineAssetSidecar(fields, dto.data, assets);
      dto.data = rewriteInlineAssets(fields, dto.data, assets);
      if (Object.keys(sidecar).length > 0) dto.assets = sidecar;
    }
  }

  async createEntry(input: {
    collection: string;
    slug: string;
    locale?: string;
    data: Record<string, unknown>;
    status?: 'draft' | 'published';
  }): Promise<EntryDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const collection = await this.getCollection(input.collection);
    const locale = input.locale ?? (await this.defaultLocaleCode(actor.orgId));

    const errors = validateEntryData(collection.fields, input.data);
    if (errors.length > 0) {
      throw new CmsInvalidError(
        `validation failed: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`,
        { fieldErrors: errors },
      );
    }
    await this.assertAssetsExist(actor.orgId, collection.fields, input.data);

    await this.quotas.assertCanAdd('cms_entries');

    const status: EntryStatus = input.status === 'published' ? 'published' : 'draft';
    const hash = contentHash(`${input.slug}|${locale}|${status}`, JSON.stringify(input.data));
    const searchText = buildSearchText(
      collection.fields,
      input.data,
      readSearchableFieldsOverride(collection.settings),
    );
    const embedding = await this.computeEmbedding(searchText);

    const tag = actor.type === 'user' ? 'user' : 'agent';
    const [row] = await ctx.db
      .insert(schema.cmsEntries)
      .values({
        orgId: actor.orgId,
        collectionId: collection.id,
        slug: input.slug,
        locale,
        status,
        data: input.data,
        version: 1,
        contentHash: hash,
        searchText,
        embedding,
        publishedAt: status === 'published' ? new Date() : null,
        createdByType: tag,
        createdById: actor.id,
        updatedByType: tag,
        updatedById: actor.id,
      })
      .returning();

    await this.snapshotVersion(row!, actor.id, tag);
    await this.rewriteReferences(row!.id, row!.orgId, collection.fields, input.data);
    await this.rewriteAssetReferences(row!.id, row!.orgId, collection.fields, input.data);

    await this.webhooks.emit({
      type: 'cms.entry.created',
      payload: makePayload(row!, collection.slug),
    });
    if (status === 'published') {
      await this.webhooks.emit({
        type: 'cms.entry.published',
        payload: makePayload(row!, collection.slug),
      });
    }
    return toEntryDto(row!, collection.slug, collection.fields);
  }

  async updateEntry(input: {
    id: string;
    ifVersion: number;
    data?: Record<string, unknown>;
    slug?: string;
    locale?: string;
  }): Promise<EntryDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const existing = await this.loadEntryRow(input.id);
    if (existing.version !== input.ifVersion) {
      throw new CmsConflictError(existing.version, input.ifVersion);
    }
    const collection = await this.getCollectionById(existing.collectionId);

    const existingData = (existing.data ?? {});
    const newData = input.data
      ? { ...existingData, ...input.data }
      : existingData;
    if (input.data) {
      const errors = validateEntryData(collection.fields, newData);
      if (errors.length > 0) {
        throw new CmsInvalidError(
          `validation failed: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`,
          { fieldErrors: errors },
        );
      }
      await this.assertAssetsExist(actor.orgId, collection.fields, newData);
    }
    const newSlug = input.slug ?? existing.slug;
    const newLocale = input.locale ?? existing.locale;
    const hash = contentHash(
      `${newSlug}|${newLocale}|${existing.status}`,
      JSON.stringify(newData),
    );
    const dataChanged = hash !== existing.contentHash;

    const tag = actor.type === 'user' ? 'user' : 'agent';
    const updates: Record<string, unknown> = {
      slug: newSlug,
      locale: newLocale,
      data: newData,
      version: existing.version + 1,
      contentHash: hash,
      updatedAt: new Date(),
      updatedByType: tag,
      updatedById: actor.id,
    };
    if (dataChanged) {
      updates.searchText = buildSearchText(
        collection.fields,
        newData,
        readSearchableFieldsOverride(collection.settings),
      );
      updates.embedding = await this.computeEmbedding(updates.searchText as string);
    }
    const [updated] = await ctx.db
      .update(schema.cmsEntries)
      .set(updates)
      .where(eq(schema.cmsEntries.id, input.id))
      .returning();

    await this.snapshotVersion(updated!, actor.id, tag);
    if (dataChanged) {
      await this.rewriteReferences(updated!.id, updated!.orgId, collection.fields, newData);
      await this.rewriteAssetReferences(updated!.id, updated!.orgId, collection.fields, newData);
    }

    await this.webhooks.emit({
      type: 'cms.entry.updated',
      payload: makePayload(updated!, collection.slug),
    });
    const dto = toEntryDto(updated!, collection.slug, collection.fields);
    await this.expandAssetsInDtos(
      actor.orgId,
      [dto],
      new Map([[dto.id, collection.fields]]),
    );
    return dto;
  }

  async publishEntry(input: { id: string; ifVersion: number }): Promise<EntryDto> {
    return this.transition(input, 'published');
  }

  async unpublishEntry(input: { id: string; ifVersion: number }): Promise<EntryDto> {
    return this.transition(input, 'draft');
  }

  async scheduleEntry(input: {
    id: string;
    ifVersion: number;
    scheduledAt: string;
  }): Promise<EntryDto> {
    const at = new Date(input.scheduledAt);
    if (Number.isNaN(at.getTime())) {
      throw new CmsInvalidError('scheduledAt must be ISO 8601');
    }
    if (at.getTime() <= Date.now()) {
      throw new CmsInvalidError('scheduledAt must be in the future');
    }
    return this.transition({ ...input, scheduledAt: at }, 'scheduled');
  }

  async deleteEntry(input: { id: string; ifVersion: number }): Promise<{ deleted: true }> {
    const ctx = getCurrentContext();
    const existing = await this.loadEntryRow(input.id);
    if (existing.version !== input.ifVersion) {
      throw new CmsConflictError(existing.version, input.ifVersion);
    }
    const collection = await this.getCollectionById(existing.collectionId);
    await ctx.db.delete(schema.cmsEntries).where(eq(schema.cmsEntries.id, input.id));
    await this.webhooks.emit({
      type: 'cms.entry.deleted',
      payload: { entryId: input.id, slug: existing.slug, collectionSlug: collection.slug },
    });
    return { deleted: true };
  }

  async listVersions(entryId: string): Promise<VersionDto[]> {
    const ctx = getCurrentContext();
    await this.loadEntryRow(entryId);
    const rows = await ctx.db
      .select()
      .from(schema.cmsEntryVersions)
      .where(eq(schema.cmsEntryVersions.entryId, entryId))
      .orderBy(desc(schema.cmsEntryVersions.version));
    return rows.map(toVersionDto);
  }

  async restoreVersion(input: {
    entryId: string;
    version: number;
    ifVersion: number;
  }): Promise<EntryDto> {
    const ctx = getCurrentContext();
    const existing = await this.loadEntryRow(input.entryId);
    if (existing.version !== input.ifVersion) {
      throw new CmsConflictError(existing.version, input.ifVersion);
    }
    const target = await ctx.db
      .select()
      .from(schema.cmsEntryVersions)
      .where(
        and(
          eq(schema.cmsEntryVersions.entryId, input.entryId),
          eq(schema.cmsEntryVersions.version, input.version),
        ),
      )
      .limit(1);
    if (!target[0]) {
      throw new NotFoundException(`cms_not_found: version ${input.entryId}@${input.version}`);
    }
    const result = await this.updateEntry({
      id: input.entryId,
      ifVersion: existing.version,
      data: target[0].data,
    });
    return result;
  }

  // ─── Assets ──────────────────────────────────────────────────────────

  async listAssets(input: { limit?: number }): Promise<AssetDto[]> {
    const ctx = getCurrentContext();
    const limit = clampLimit(input.limit, 50, 200);
    const rows = await ctx.db
      .select()
      .from(schema.cmsAssets)
      .orderBy(desc(schema.cmsAssets.createdAt))
      .limit(limit);
    return rows.map(toAssetDto);
  }

  async requestAssetUpload(input: {
    name: string;
    mime: string;
    sizeBytes: number;
    altText?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AssetUploadHandle> {
    if (input.sizeBytes <= 0 || input.sizeBytes > 50 * 1024 * 1024) {
      throw new CmsInvalidError('sizeBytes must be in (0, 50MB]');
    }
    const ext = assetExtensionFromName(input.name);
    rejectSvgAsset(ext, input.mime);
    await this.quotas.assertCanAdd('cms_assets');

    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const key = `cms/${actor.orgId}/${randomKeySegment()}.${ext}`;
    const presigned = await this.storage.presignedUpload({
      key,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
    });

    const tag = actor.type === 'user' ? 'user' : 'agent';
    const [row] = await ctx.db
      .insert(schema.cmsAssets)
      .values({
        orgId: actor.orgId,
        name: input.name,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        storageProvider: this.storage.provider,
        storageKey: key,
        publicUrl: presigned.publicUrl,
        altText: input.altText ?? null,
        metadata: input.metadata ?? {},
        uploaded: false,
        createdByType: tag,
        createdById: actor.id,
      })
      .returning();
    return {
      ...toAssetDto(row!),
      uploadUrl: presigned.uploadUrl,
      uploadMethod: presigned.uploadMethod,
      uploadFields: presigned.uploadFields,
      uploadExpiresAt: presigned.expiresAt.toISOString(),
    };
  }

  async uploadAssetFromBase64(input: {
    name: string;
    mime: string;
    base64Body: string;
    altText?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AssetDto> {
    const body = decodeAssetBody(input.base64Body);
    return this.persistAssetBytes({
      name: input.name,
      mime: input.mime,
      body,
      altText: input.altText,
      metadata: input.metadata,
    });
  }

  async uploadAssetFromUrl(input: {
    sourceUrl: string;
    name?: string;
    mime?: string;
    altText?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AssetDto> {
    const res = await safeFetch(input.sourceUrl, {
      method: 'GET',
      headers: { 'user-agent': 'Munin-CMS/1.0 (+https://getmunin.com)' },
      signal: AbortSignal.timeout(15_000),
    }).catch((err) => {
      throw new CmsInvalidError(
        err instanceof SsrfBlockedError
          ? `sourceUrl blocked: ${err.message}`
          : `fetch failed: ${describeError(err)}`,
      );
    });
    if (!res.ok) throw new CmsInvalidError(`fetch failed with status ${res.status}`);

    const mime = (
      input.mime ?? res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'application/octet-stream'
    ).toLowerCase();
    if (!isAllowedFetchedMime(mime)) {
      throw new CmsInvalidError(`fetched content-type "${mime}" is not allowed`);
    }

    const body = await readBodyWithCap(res, FETCH_BYTES_MAX);
    if (body.length === 0) throw new CmsInvalidError('fetched body is empty');

    return this.persistAssetBytes({
      name: input.name ?? deriveNameFromUrl(new URL(input.sourceUrl), mime),
      mime,
      body,
      altText: input.altText,
      metadata: { ...(input.metadata ?? {}), sourceUrl: input.sourceUrl },
    });
  }

  private async persistAssetBytes(input: {
    name: string;
    mime: string;
    body: Buffer;
    altText?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AssetDto> {
    const ext = assetExtensionFromName(input.name);
    rejectSvgAsset(ext, input.mime);
    await this.quotas.assertCanAdd('cms_assets');

    if (!this.storage.writeDirect) {
      throw new Error('storage backend does not support direct writes');
    }
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const key = `cms/${actor.orgId}/${randomKeySegment()}.${ext}`;
    await this.storage.writeDirect(key, input.body, { mime: input.mime });

    const [row] = await ctx.db
      .insert(schema.cmsAssets)
      .values({
        orgId: actor.orgId,
        name: input.name,
        mime: input.mime,
        sizeBytes: input.body.length,
        storageProvider: this.storage.provider,
        storageKey: key,
        publicUrl: this.storage.publicUrlFor(key),
        altText: input.altText ?? null,
        metadata: input.metadata ?? {},
        uploaded: true,
        createdByType: actor.type === 'user' ? 'user' : 'agent',
        createdById: actor.id,
      })
      .returning();
    return toAssetDto(row!);
  }

  async completeAssetUpload(input: { id: string }): Promise<AssetDto> {
    const ctx = getCurrentContext();
    const [existing] = await ctx.db
      .select()
      .from(schema.cmsAssets)
      .where(eq(schema.cmsAssets.id, input.id))
      .limit(1);
    if (!existing) throw new NotFoundException(`cms_not_found: asset ${input.id}`);

    const actualBytes = await this.storage.statBytes(existing.storageKey);
    if (actualBytes == null) {
      throw new BadRequestException(
        `cms_upload_missing: object ${existing.storageKey} not found in storage`,
      );
    }
    if (actualBytes !== existing.sizeBytes) {
      await this.storage.delete(existing.storageKey).catch((err) => {
        console.warn(
          `[cms] failed to delete oversized upload ${existing.storageKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      throw new BadRequestException(
        `cms_upload_size_mismatch: declared ${existing.sizeBytes} bytes, uploaded ${actualBytes}`,
      );
    }

    const [row] = await ctx.db
      .update(schema.cmsAssets)
      .set({ uploaded: true, updatedAt: new Date() })
      .where(eq(schema.cmsAssets.id, input.id))
      .returning();
    if (!row) throw new NotFoundException(`cms_not_found: asset ${input.id}`);
    return toAssetDto(row);
  }

  async deleteAsset(input: { id: string }): Promise<{ deleted: true }> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.cmsAssets)
      .where(eq(schema.cmsAssets.id, input.id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`cms_not_found: asset ${input.id}`);

    const usage = await this.listAssetUsage(input.id);
    if (usage.length > 0) {
      const entries = [...new Set(usage.map((u) => u.fromEntryId))];
      const preview = entries.slice(0, 10).join(', ');
      const suffix = entries.length > 10 ? `, +${entries.length - 10} more` : '';
      throw new ConflictException(
        `cms_conflict: asset ${input.id} is referenced by ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (${preview}${suffix})`,
      );
    }

    await this.storage.delete(rows[0].storageKey).catch(() => {
      // Storage delete failure shouldn't block row deletion — log via audit
      // and let an operator GC the orphan later.
    });
    await ctx.db.delete(schema.cmsAssets).where(eq(schema.cmsAssets.id, input.id));
    return { deleted: true };
  }

  async listAssetUsage(
    assetId: string,
  ): Promise<{ fromEntryId: string; fieldName: string; kind: string }[]> {
    const ctx = getCurrentContext();
    return ctx.db
      .select({
        fromEntryId: schema.cmsAssetReferences.fromEntryId,
        fieldName: schema.cmsAssetReferences.fieldName,
        kind: schema.cmsAssetReferences.kind,
      })
      .from(schema.cmsAssetReferences)
      .where(eq(schema.cmsAssetReferences.assetId, assetId))
      .orderBy(desc(schema.cmsAssetReferences.createdAt));
  }

  // ─── Locales ─────────────────────────────────────────────────────────

  async listLocales(): Promise<LocaleDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.cmsLocales)
      .orderBy(asc(schema.cmsLocales.position), asc(schema.cmsLocales.code));
    return rows.map(toLocaleDto);
  }

  async createLocale(input: {
    code: string;
    name: string;
    isDefault?: boolean;
  }): Promise<LocaleDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(input.code)) {
      throw new CmsInvalidError('code must be ISO 639-1 (e.g. "en") or BCP-47 (e.g. "en-US")');
    }
    const existing = await ctx.db
      .select()
      .from(schema.cmsLocales)
      .where(eq(schema.cmsLocales.orgId, actor.orgId))
      .orderBy(desc(schema.cmsLocales.position));
    if (existing.some((l) => l.code === input.code)) {
      throw new ConflictException(`cms_locale_conflict: ${input.code}`);
    }
    const position = existing[0] ? existing[0].position + 1 : 0;
    const isDefault = input.isDefault ?? existing.length === 0;
    if (isDefault) {
      await ctx.db
        .update(schema.cmsLocales)
        .set({ isDefault: false })
        .where(eq(schema.cmsLocales.orgId, actor.orgId));
    }
    const [row] = await ctx.db
      .insert(schema.cmsLocales)
      .values({
        orgId: actor.orgId,
        code: input.code,
        name: input.name,
        isDefault,
        position,
      })
      .returning();
    return toLocaleDto(row!);
  }

  async setDefaultLocale(input: { code: string }): Promise<LocaleDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const target = await ctx.db
      .select()
      .from(schema.cmsLocales)
      .where(and(eq(schema.cmsLocales.orgId, actor.orgId), eq(schema.cmsLocales.code, input.code)))
      .limit(1);
    if (!target[0]) throw new NotFoundException(`cms_not_found: locale ${input.code}`);
    await ctx.db
      .update(schema.cmsLocales)
      .set({ isDefault: false })
      .where(eq(schema.cmsLocales.orgId, actor.orgId));
    const [row] = await ctx.db
      .update(schema.cmsLocales)
      .set({ isDefault: true })
      .where(eq(schema.cmsLocales.id, target[0].id))
      .returning();
    return toLocaleDto(row!);
  }

  // ─── References ──────────────────────────────────────────────────────

  async listInboundReferences(entryId: string): Promise<{ fromEntryId: string; fieldName: string }[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        fromEntryId: schema.cmsReferences.fromEntryId,
        fieldName: schema.cmsReferences.fieldName,
      })
      .from(schema.cmsReferences)
      .where(eq(schema.cmsReferences.toEntryId, entryId))
      .orderBy(desc(schema.cmsReferences.createdAt));
    return rows;
  }

  // ─── Transfer (import / export) ──────────────────────────────────────

  async exportCms(): Promise<CmsExportData> {
    const ctx = getCurrentContext();
    const [locales, collections, entries, assets] = await Promise.all([
      ctx.db.select().from(schema.cmsLocales).orderBy(asc(schema.cmsLocales.createdAt)),
      ctx.db.select().from(schema.cmsCollections).orderBy(asc(schema.cmsCollections.createdAt)),
      ctx.db.select().from(schema.cmsEntries).orderBy(asc(schema.cmsEntries.createdAt)),
      ctx.db.select().from(schema.cmsAssets).orderBy(asc(schema.cmsAssets.createdAt)),
    ]);

    const assetExports: CmsAssetExport[] = [];
    for (const a of assets) {
      let base64Body: string | null = null;
      if (a.uploaded && a.sizeBytes <= EXPORT_ASSET_BYTES_MAX) {
        const bytes = await this.storage.readBytes(a.storageKey).catch(() => null);
        if (bytes) base64Body = bytes.toString('base64');
      }
      assetExports.push({
        id: a.id,
        name: a.name,
        mime: a.mime,
        sizeBytes: a.sizeBytes,
        storageKey: a.storageKey,
        altText: a.altText,
        metadata: a.metadata,
        base64Body,
      });
    }

    return {
      locales: locales.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        isDefault: l.isDefault,
      })),
      collections: collections.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        fields: c.fields as FieldDef[],
        localized: c.localized,
        settings: c.settings,
      })),
      entries: entries.map((e) => ({
        id: e.id,
        collectionId: e.collectionId,
        slug: e.slug,
        locale: e.locale,
        status: e.status as EntryStatus,
        data: e.data,
        scheduledAt: e.scheduledAt?.toISOString() ?? null,
      })),
      assets: assetExports,
    };
  }

  async importCms(data: CmsExportData, priorIdMap: IdMap = {}): Promise<ImportResult> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const result = newImportResult();
    result.idMap = { ...priorIdMap };

    for (const locale of data.locales) {
      const existing = await this.findLocaleForImport(actor.orgId, locale.code);
      if (existing) {
        result.idMap[locale.id] = existing.id;
        result.skipped++;
      } else {
        const created = await this.createLocale({
          code: locale.code,
          name: locale.name,
          isDefault: locale.isDefault,
        });
        result.idMap[locale.id] = created.id;
        result.created++;
      }
    }

    for (const collection of data.collections) {
      const existing = await this.findCollectionForImport(actor.orgId, collection.slug);
      if (existing) {
        result.idMap[collection.id] = existing.id;
        result.skipped++;
      } else {
        const created = await this.createCollection({
          name: collection.name,
          slug: collection.slug,
          description: collection.description ?? undefined,
          fields: collection.fields,
          localized: collection.localized,
          settings: collection.settings,
        });
        result.idMap[collection.id] = created.id;
        result.created++;
      }
    }

    for (const asset of data.assets) {
      const existing = await this.findAssetForImport(actor.orgId, asset.name, asset.sizeBytes);
      if (existing) {
        result.idMap[asset.id] = existing.id;
        result.skipped++;
        continue;
      }
      if (!asset.base64Body) {
        result.warnings.push(
          `asset "${asset.name}" imported without bytes: source did not include a body (too large or unreadable on export)`,
        );
        const placeholder = await this.upsertAssetMetadataOnly(asset);
        result.idMap[asset.id] = placeholder.id;
        result.created++;
        continue;
      }
      try {
        const created = await this.persistAssetBytes({
          name: asset.name,
          mime: asset.mime,
          body: Buffer.from(asset.base64Body, 'base64'),
          altText: asset.altText ?? undefined,
          metadata: asset.metadata,
        });
        result.idMap[asset.id] = created.id;
        result.created++;
      } catch (err) {
        result.warnings.push(
          `asset "${asset.name}" bytes could not be re-uploaded (${describeError(err)}); imported metadata only`,
        );
        const placeholder = await this.upsertAssetMetadataOnly(asset);
        result.idMap[asset.id] = placeholder.id;
        result.created++;
      }
    }

    for (const entry of data.entries) {
      const targetCollectionId = resolveId(result.idMap, entry.collectionId);
      if (!targetCollectionId) {
        result.warnings.push(
          `entry "${entry.slug}" skipped: source collection ${entry.collectionId} was not part of this import`,
        );
        result.skipped++;
        continue;
      }
      const collection = await this.getCollectionById(targetCollectionId);
      const remappedData = remapEntryData(collection.fields, entry.data, result.idMap);

      const existing = await this.findEntryForImport(
        actor.orgId,
        targetCollectionId,
        entry.slug,
        entry.locale,
      );
      if (existing) {
        result.idMap[entry.id] = existing.id;
        if (existing.contentHash !== contentHash(
          `${entry.slug}|${entry.locale}|${existing.status}`,
          JSON.stringify(remappedData),
        )) {
          await this.updateEntry({
            id: existing.id,
            ifVersion: existing.version,
            data: remappedData,
          });
          result.updated++;
        } else {
          result.skipped++;
        }
      } else {
        const created = await this.createEntry({
          collection: targetCollectionId,
          slug: entry.slug,
          locale: entry.locale,
          data: remappedData,
          status: entry.status === 'published' ? 'published' : 'draft',
        });
        result.idMap[entry.id] = created.id;
        result.created++;
      }
    }

    return result;
  }

  private async findLocaleForImport(
    orgId: string,
    code: string,
  ): Promise<{ id: string } | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.cmsLocales.id })
      .from(schema.cmsLocales)
      .where(and(eq(schema.cmsLocales.orgId, orgId), eq(schema.cmsLocales.code, code)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findCollectionForImport(
    orgId: string,
    slug: string,
  ): Promise<{ id: string } | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.cmsCollections.id })
      .from(schema.cmsCollections)
      .where(and(eq(schema.cmsCollections.orgId, orgId), eq(schema.cmsCollections.slug, slug)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findEntryForImport(
    orgId: string,
    collectionId: string,
    slug: string,
    locale: string,
  ): Promise<{ id: string; version: number; status: EntryStatus; contentHash: string } | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        id: schema.cmsEntries.id,
        version: schema.cmsEntries.version,
        status: schema.cmsEntries.status,
        contentHash: schema.cmsEntries.contentHash,
      })
      .from(schema.cmsEntries)
      .where(
        and(
          eq(schema.cmsEntries.orgId, orgId),
          eq(schema.cmsEntries.collectionId, collectionId),
          eq(schema.cmsEntries.slug, slug),
          eq(schema.cmsEntries.locale, locale),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, version: row.version, status: row.status as EntryStatus, contentHash: row.contentHash };
  }

  private async findAssetForImport(
    orgId: string,
    name: string,
    sizeBytes: number,
  ): Promise<{ id: string } | null> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.cmsAssets.id })
      .from(schema.cmsAssets)
      .where(
        and(
          eq(schema.cmsAssets.orgId, orgId),
          eq(schema.cmsAssets.name, name),
          eq(schema.cmsAssets.sizeBytes, sizeBytes),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async upsertAssetMetadataOnly(asset: CmsAssetExport): Promise<AssetDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const key = `cms/${actor.orgId}/${randomKeySegment()}.${assetExtensionFromName(asset.name)}`;
    const [row] = await ctx.db
      .insert(schema.cmsAssets)
      .values({
        orgId: actor.orgId,
        name: asset.name,
        mime: asset.mime,
        sizeBytes: asset.sizeBytes,
        storageProvider: this.storage.provider,
        storageKey: key,
        publicUrl: this.storage.publicUrlFor(key),
        altText: asset.altText ?? null,
        metadata: asset.metadata,
        uploaded: false,
        createdByType: actor.type === 'user' ? 'user' : 'agent',
        createdById: actor.id,
      })
      .returning();
    return toAssetDto(row!);
  }

  // ─── Internals ───────────────────────────────────────────────────────

  /** Used by the schedule worker to flip due entries to published. */
  async publishById(id: string): Promise<EntryDto> {
    const existing = await this.loadEntryRow(id);
    return this.transition({ id, ifVersion: existing.version }, 'published');
  }

  private async transition(
    input: { id: string; ifVersion: number; scheduledAt?: Date },
    status: EntryStatus,
  ): Promise<EntryDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const existing = await this.loadEntryRow(input.id);
    if (existing.version !== input.ifVersion) {
      throw new CmsConflictError(existing.version, input.ifVersion);
    }
    const collection = await this.getCollectionById(existing.collectionId);

    const tag = actor.type === 'user' ? 'user' : 'agent';
    const updates: Record<string, unknown> = {
      status,
      version: existing.version + 1,
      updatedAt: new Date(),
      updatedByType: tag,
      updatedById: actor.id,
    };
    if (status === 'published') {
      updates.publishedAt = new Date();
      updates.scheduledAt = null;
    } else if (status === 'scheduled') {
      updates.scheduledAt = input.scheduledAt;
    } else if (status === 'draft') {
      updates.publishedAt = null;
    } else if (status === 'archived') {
      updates.scheduledAt = null;
    }

    const [updated] = await ctx.db
      .update(schema.cmsEntries)
      .set(updates)
      .where(eq(schema.cmsEntries.id, input.id))
      .returning();
    await this.snapshotVersion(updated!, actor.id, tag);

    if (status === 'published') {
      await this.webhooks.emit({
        type: 'cms.entry.published',
        payload: makePayload(updated!, collection.slug),
      });
    } else if (status === 'draft') {
      await this.webhooks.emit({
        type: 'cms.entry.unpublished',
        payload: makePayload(updated!, collection.slug),
      });
    } else if (status === 'scheduled') {
      await this.webhooks.emit({
        type: 'cms.entry.scheduled',
        payload: makePayload(updated!, collection.slug),
      });
    } else if (status === 'archived') {
      await this.webhooks.emit({
        type: 'cms.entry.archived',
        payload: makePayload(updated!, collection.slug),
      });
    }
    return toEntryDto(updated!, collection.slug, collection.fields);
  }

  private async loadEntryRow(id: string): Promise<typeof schema.cmsEntries.$inferSelect> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.cmsEntries)
      .where(eq(schema.cmsEntries.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`cms_not_found: entry ${id}`);
    return rows[0];
  }

  private async getCollectionById(id: string): Promise<CollectionDto> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.cmsCollections)
      .where(eq(schema.cmsCollections.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`cms_not_found: collection ${id}`);
    return toCollectionDto(rows[0]);
  }

  private async defaultLocaleCode(orgId: string): Promise<string> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.cmsLocales)
      .where(and(eq(schema.cmsLocales.orgId, orgId), eq(schema.cmsLocales.isDefault, true)))
      .limit(1);
    if (rows[0]) return rows[0].code;
    // Fall back to the first locale or 'en' if none configured.
    const any = await ctx.db
      .select()
      .from(schema.cmsLocales)
      .where(eq(schema.cmsLocales.orgId, orgId))
      .orderBy(asc(schema.cmsLocales.position))
      .limit(1);
    return any[0]?.code ?? 'en';
  }

  private async snapshotVersion(
    entry: typeof schema.cmsEntries.$inferSelect,
    actorId: string,
    actorTag: 'user' | 'agent',
  ): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db.insert(schema.cmsEntryVersions).values({
      orgId: entry.orgId,
      entryId: entry.id,
      version: entry.version,
      status: entry.status,
      data: entry.data,
      createdByType: actorTag,
      createdById: actorId,
    });
  }

  private async rewriteReferences(
    entryId: string,
    orgId: string,
    fields: FieldDef[],
    data: Record<string, unknown>,
  ): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .delete(schema.cmsReferences)
      .where(eq(schema.cmsReferences.fromEntryId, entryId));
    const refs = [...extractReferences(fields, data)];
    if (refs.length === 0) return;
    await ctx.db.insert(schema.cmsReferences).values(
      refs.map((r) => ({
        orgId,
        fromEntryId: entryId,
        toEntryId: r.toEntryId,
        fieldName: r.fieldName,
        position: r.position,
      })),
    );
  }

  private async rewriteAssetReferences(
    entryId: string,
    orgId: string,
    fields: FieldDef[],
    data: Record<string, unknown>,
  ): Promise<void> {
    const ctx = getCurrentContext();
    await ctx.db
      .delete(schema.cmsAssetReferences)
      .where(eq(schema.cmsAssetReferences.fromEntryId, entryId));
    const refs = [...extractAssetReferences(fields, data)];
    if (refs.length === 0) return;

    const referencedIds = [...new Set(refs.map((r) => r.assetId))];
    const existing = await ctx.db
      .select({ id: schema.cmsAssets.id })
      .from(schema.cmsAssets)
      .where(
        and(eq(schema.cmsAssets.orgId, orgId), inArray(schema.cmsAssets.id, referencedIds)),
      );
    const known = new Set(existing.map((r) => r.id));
    const trackable = refs.filter((r) => known.has(r.assetId));
    if (trackable.length === 0) return;

    await ctx.db.insert(schema.cmsAssetReferences).values(
      trackable.map((r) => ({
        orgId,
        fromEntryId: entryId,
        assetId: r.assetId,
        fieldName: r.fieldName,
        kind: r.kind,
        position: r.position,
      })),
    );
  }

  private async assertAssetsExist(
    orgId: string,
    fields: FieldDef[],
    data: Record<string, unknown>,
  ): Promise<void> {
    const ids = [
      ...new Set(
        [...extractAssetReferences(fields, data)]
          .filter((r) => r.kind === 'inline')
          .map((r) => r.assetId),
      ),
    ];
    if (ids.length === 0) return;
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ id: schema.cmsAssets.id })
      .from(schema.cmsAssets)
      .where(
        and(
          eq(schema.cmsAssets.orgId, orgId),
          eq(schema.cmsAssets.uploaded, true),
          inArray(schema.cmsAssets.id, ids),
        ),
      );
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new CmsInvalidError(
        `unknown or unconfirmed inline asset(s): ${missing.join(', ')}`,
      );
    }
  }

  private async computeEmbedding(searchText: string): Promise<number[] | null> {
    if (!searchText.trim()) return null;
    try {
      const provider = this.embeddings.get();
      const [vec] = await provider.embed([searchText.slice(0, 8_000)]);
      return vec ?? null;
    } catch {
      return null;
    }
  }
}

// ─── DTO mappers ───────────────────────────────────────────────────────

function toCollectionDto(row: typeof schema.cmsCollections.$inferSelect): CollectionDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    fields: row.fields as FieldDef[],
    localized: row.localized,
    settings: row.settings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEntryDto(
  row: typeof schema.cmsEntries.$inferSelect,
  collectionSlug: string,
  fields: FieldDef[],
): EntryDto {
  return {
    id: row.id,
    collectionId: row.collectionId,
    collectionSlug,
    slug: row.slug,
    locale: row.locale,
    status: row.status as EntryStatus,
    data: projectData(fields, row.data),
    version: row.version,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toVersionDto(row: typeof schema.cmsEntryVersions.$inferSelect): VersionDto {
  return {
    id: row.id,
    entryId: row.entryId,
    version: row.version,
    status: row.status as EntryStatus,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAssetDto(row: typeof schema.cmsAssets.$inferSelect): AssetDto {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    storageProvider: row.storageProvider,
    storageKey: row.storageKey,
    publicUrl: row.publicUrl,
    altText: row.altText,
    metadata: row.metadata,
    uploaded: row.uploaded,
    createdAt: row.createdAt.toISOString(),
  };
}

function toLocaleDto(row: typeof schema.cmsLocales.$inferSelect): LocaleDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isDefault: row.isDefault,
    position: row.position,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

function remapEntryData(
  fields: FieldDef[],
  data: Record<string, unknown>,
  idMap: IdMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const remap = (id: unknown): unknown =>
    typeof id === 'string' && idMap[id] ? idMap[id] : id;
  const remapId = (id: string): string => idMap[id] ?? id;
  for (const field of fields) {
    const value = out[field.name];
    if (value === undefined || value === null) continue;
    if ((field.type === 'rich_text' || field.type === 'markdown') && typeof value === 'string') {
      out[field.name] = remapInlineAssetUris(value, remapId);
      continue;
    }
    if (field.type !== 'asset' && field.type !== 'reference') {
      const isIdArray =
        field.type === 'array' &&
        (field.options?.items?.type === 'asset' || field.options?.items?.type === 'reference');
      if (!isIdArray) continue;
    }
    if ((field.type === 'asset' || field.type === 'reference') && typeof value === 'string') {
      out[field.name] = remap(value);
    } else if (field.type === 'array' && Array.isArray(value)) {
      out[field.name] = value.map((v) => remap(v));
    }
  }
  return out;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || value <= 0) return fallback;
  return Math.min(value, max);
}

function validateFieldsShape(fields: FieldDef[]): void {
  const seen = new Set<string>();
  for (const f of fields) {
    if (!f.name || !/^[a-z][a-z0-9_]{0,63}$/.test(f.name)) {
      throw new CmsInvalidError(
        `field name ${JSON.stringify(f.name)} must be lowercase letters, digits, underscores`,
      );
    }
    if (seen.has(f.name)) throw new CmsInvalidError(`duplicate field: ${f.name}`);
    seen.add(f.name);
    if (!FIELD_TYPES.includes(f.type)) {
      throw new CmsInvalidError(`unknown field type: ${f.type}`);
    }
    if (f.type === 'array' && !f.options?.items) {
      throw new CmsInvalidError(`array field ${f.name}: options.items is required`);
    }
    if ((f.type === 'select' || f.type === 'multi_select') && !f.options?.choices?.length) {
      throw new CmsInvalidError(`${f.type} field ${f.name}: options.choices is required`);
    }
  }
}

function readSearchableFieldsOverride(settings: Record<string, unknown>): string[] | undefined {
  const v = (settings as { searchableFields?: unknown }).searchableFields;
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

function makePayload(
  row: typeof schema.cmsEntries.$inferSelect,
  collectionSlug: string,
): Record<string, unknown> {
  return {
    entryId: row.id,
    collectionSlug,
    slug: row.slug,
    locale: row.locale,
    status: row.status,
    version: row.version,
  };
}

function randomKeySegment(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSvgMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase().split(';')[0]!.trim();
  return normalized === 'image/svg+xml' || normalized === 'image/svg';
}

const UPLOAD_BYTES_MAX = 100 * 1024;

function decodeAssetBody(base64Body: string): Buffer {
  let body: Buffer;
  try {
    body = Buffer.from(base64Body, 'base64');
  } catch {
    throw new CmsInvalidError('base64Body is not valid base64');
  }
  if (body.length === 0) {
    throw new CmsInvalidError('base64Body decoded to 0 bytes');
  }
  if (body.length > UPLOAD_BYTES_MAX) {
    throw new CmsInvalidError(
      'base64Body decoded size exceeds 100KB; compress further (WebP/JPEG, smaller dimensions) or use cms_upload_asset_from_url with a public HTTPS URL',
    );
  }
  if (body.toString('base64').replace(/=+$/, '') !== base64Body.replace(/=+$/, '')) {
    throw new CmsInvalidError('base64Body contains invalid characters');
  }
  return body;
}

function assetExtensionFromName(name: string): string {
  return (name.split('.').pop() ?? 'bin').toLowerCase().slice(0, 16);
}

function readStringField(data: unknown, field: string): string | null {
  if (!data || typeof data !== 'object') return null;
  const value = (data as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function countWordsInBody(data: unknown): number | null {
  const body = readStringField(data, 'body');
  if (body == null) return null;
  const matches = body.match(/\S+/g);
  return matches ? matches.length : 0;
}

const TITLE_FIELD_CANDIDATES = ['title', 'name', 'headline', 'subject'];

export function deriveEntryTitle(
  fields: FieldDef[],
  data: Record<string, unknown>,
): { title: string | null; fieldName: string | null } {
  for (const name of TITLE_FIELD_CANDIDATES) {
    if (!fields.some((f) => f.name === name)) continue;
    const value = readStringField(data, name);
    if (value) return { title: value, fieldName: name };
  }
  const firstShortText = fields.find((f) => f.type === 'text' && f.required);
  if (firstShortText) {
    const value = readStringField(data, firstShortText.name);
    if (value) return { title: value, fieldName: firstShortText.name };
  }
  return { title: null, fieldName: null };
}

function rejectSvgAsset(ext: string, mime: string): void {
  if (ext === 'svg' || isSvgMime(mime)) {
    throw new CmsInvalidError(
      'svg uploads are not allowed: SVG can carry inline scripts that execute in the browser',
    );
  }
}

const FETCH_BYTES_MAX = 50 * 1024 * 1024;

const FETCHED_MIME_ALLOWLIST = [/^image\//, /^video\//, /^audio\//, /^application\/pdf$/];

function isAllowedFetchedMime(mime: string): boolean {
  if (isSvgMime(mime)) return false;
  return FETCHED_MIME_ALLOWLIST.some((re) => re.test(mime));
}

async function readBodyWithCap(
  res: { body: ReadableStream<Uint8Array> | null; arrayBuffer: () => Promise<ArrayBuffer> },
  cap: number,
): Promise<Buffer> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > cap) {
      throw new CmsInvalidError(`fetched body exceeds ${cap} bytes`);
    }
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw new CmsInvalidError(`fetched body exceeds ${cap} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
};

function deriveNameFromUrl(url: URL, mime: string): string {
  const last = url.pathname.split('/').filter(Boolean).pop();
  if (last && last.includes('.')) return decodeURIComponent(last).slice(0, 200);
  const ext = MIME_TO_EXT[mime] ?? mime.split('/')[1] ?? 'bin';
  return `asset.${ext.replace(/[^a-z0-9]/gi, '').slice(0, 16) || 'bin'}`;
}
