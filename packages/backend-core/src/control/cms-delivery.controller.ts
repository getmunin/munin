import {
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { schema, type Db } from '@getmunin/db';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  readApiBaseUrl,
  signViewToken,
  verifyPreviewToken,
  type PreviewTokenPayload,
} from '@getmunin/core';
import { PublicController } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';
import { CmsSearchService } from '../modules/cms/cms.search.ts';
import { AnalyticsService } from '../modules/analytics/analytics.service.ts';
import {
  applyAssetExpansion,
  applyReferenceExpansion,
  buildInlineAssetSidecar,
  buildReferenceSidecar,
  collectAssetIds,
  collectInlineReferenceIds,
  collectReferenceIds,
  projectData,
  rewriteInlineAssets,
  type FieldDef,
} from '../modules/cms/cms.fields.ts';
import { loadAssetMap } from '../modules/cms/cms.asset-loader.ts';
import { loadEntryMap } from '../modules/cms/cms.entry-loader.ts';

@PublicController('v1/cms', { throttle: true })
export class CmsDeliveryController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CmsSearchService) private readonly search: CmsSearchService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  @Get(':orgId/collections')
  @Header('cache-control', 'public, max-age=60, stale-while-revalidate=600')
  async listCollections(@Param('orgId') orgId: string) {
    const org = await this.resolveOrg(orgId);
    const rows = await this.db
      .select()
      .from(schema.cmsCollections)
      .where(eq(schema.cmsCollections.orgId, org.id))
      .orderBy(schema.cmsCollections.name);
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      description: r.description,
      fields: r.fields as FieldDef[],
      localized: r.localized,
    }));
  }

  @Get(':orgId/search')
  @Header('cache-control', 'public, max-age=30, stale-while-revalidate=300')
  async searchPublic(
    @Param('orgId') orgId: string,
    @Query('q') q?: string,
    @Query('collection') collection?: string,
    @Query('locale') locale?: string,
    @Query('limit') limit?: string,
    @Query('visitor_id') visitorId?: string,
    @Query('include') include?: string,
  ) {
    if (!q || !q.trim()) return [];
    const org = await this.resolveOrg(orgId);
    const hits = await this.search.search(
      {
        query: q,
        collection,
        locale,
        limit: limit ? Number.parseInt(limit, 10) : undefined,
        publishedOnly: true,
        ...(includeReferences(include) ? { include: ['references'] } : {}),
      },
      { orgId: org.id },
    );
    void this.analytics.recordSearch({
      orgId: org.id,
      subjectType: 'cms',
      query: q,
      resultCount: hits.length,
      locale,
      visitorId,
    });
    return hits;
  }

  @Get(':orgId/:collectionSlug')
  async listEntries(
    @Param('orgId') orgId: string,
    @Param('collectionSlug') collectionSlug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('locale') locale?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('tracking') tracking?: string,
    @Query('include') include?: string,
  ) {
    const { org, collection } = await this.resolveOrgCollection(orgId, collectionSlug);
    const filters: SQL[] = [
      eq(schema.cmsEntries.orgId, org.id),
      eq(schema.cmsEntries.collectionId, collection.id),
      eq(schema.cmsEntries.status, 'published'),
    ];
    if (locale) filters.push(eq(schema.cmsEntries.locale, locale));
    if (before) {
      filters.push(sql`${schema.cmsEntries.publishedAt} < ${new Date(before).toISOString()}::timestamptz`);
    }

    const take = clampLimit(limit, 25, 100);
    const rows = await this.db
      .select()
      .from(schema.cmsEntries)
      .where(and(...filters))
      .orderBy(desc(schema.cmsEntries.publishedAt))
      .limit(take);

    const fields = collection.fields as FieldDef[];
    const trackingOn = trackingEnabled(tracking);
    const projected = rows.map((r) => ({
      id: r.id,
      translationGroupId: r.translationGroupId,
      slug: r.slug,
      locale: r.locale,
      data: projectData(fields, r.data),
      version: r.version,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
    const assets = await this.fetchAssets(org.id, fields, projected.map((p) => p.data));
    const entryMap = includeReferences(include)
      ? await this.fetchReferencedEntries(org.id, fields, projected.map((p) => p.data), {
          publishedOnly: true,
        })
      : null;
    const localeMap = await this.fetchLocaleAlternatesBatch(
      org.id,
      projected.map((p) => p.translationGroupId),
    );
    const items = projected.map(({ id, translationGroupId, ...p }) => {
      const expanded = applyAssetExpansion(fields, p.data, assets);
      const assetSidecar = buildInlineAssetSidecar(fields, expanded, assets);
      let data = rewriteInlineAssets(fields, expanded, assets);
      const refSidecar = entryMap ? buildReferenceSidecar(fields, data, entryMap) : {};
      if (entryMap) data = applyReferenceExpansion(fields, data, entryMap);
      const locales = localeMap.get(translationGroupId) ?? [];
      return {
        ...p,
        data,
        ...(Object.keys(assetSidecar).length > 0 ? { _assets: assetSidecar } : {}),
        ...(Object.keys(refSidecar).length > 0 ? { _refs: refSidecar } : {}),
        ...(locales.length > 0 ? { _locales: locales } : {}),
        ...(trackingOn ? { _tracking: buildTracking(org.id, id) } : {}),
      };
    });

    const etag = computeEtag(rows.map((r) => r.updatedAt.getTime()));
    if (handleEtag(req, res, etag)) return;
    setCdnHeaders(res);
    return { collection: { slug: collection.slug, name: collection.name }, items };
  }

  @Get(':orgId/:collectionSlug/:entrySlug')
  async getEntry(
    @Param('orgId') orgId: string,
    @Param('collectionSlug') collectionSlug: string,
    @Param('entrySlug') entrySlug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('locale') locale?: string,
    @Query('tracking') tracking?: string,
    @Query('include') include?: string,
    @Query('preview') preview?: string,
  ) {
    const { org, collection } = await this.resolveOrgCollection(orgId, collectionSlug);
    if (preview !== undefined) {
      return this.getEntryPreview(org, collection, entrySlug, preview, res, locale, include);
    }
    const filters: SQL[] = [
      eq(schema.cmsEntries.orgId, org.id),
      eq(schema.cmsEntries.collectionId, collection.id),
      eq(schema.cmsEntries.slug, entrySlug),
      eq(schema.cmsEntries.status, 'published'),
    ];
    if (locale) filters.push(eq(schema.cmsEntries.locale, locale));

    const rows = await this.db
      .select()
      .from(schema.cmsEntries)
      .where(and(...filters))
      .orderBy(desc(schema.cmsEntries.publishedAt))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`cms_not_found: entry ${entrySlug}`);

    const etag = computeEtag([row.updatedAt.getTime()]);
    if (handleEtag(req, res, etag)) return;
    setCdnHeaders(res);
    const body = await this.renderEntry(org.id, collection, row, include, {
      publishedOnly: true,
    });
    return {
      ...body,
      ...(trackingEnabled(tracking) ? { _tracking: buildTracking(org.id, row.id) } : {}),
    };
  }

  private async getEntryPreview(
    org: { id: string },
    collection: typeof schema.cmsCollections.$inferSelect,
    entrySlug: string,
    token: string,
    res: Response,
    locale?: string,
    include?: string,
  ) {
    let payload: PreviewTokenPayload;
    try {
      payload = verifyPreviewToken(token);
    } catch (err) {
      throw new ForbiddenException(
        err instanceof Error ? err.message : 'preview_token_invalid: token rejected',
      );
    }
    if (payload.orgId !== org.id) {
      throw new ForbiddenException('preview_token_invalid: token is for another org');
    }

    const rows = await this.db
      .select()
      .from(schema.cmsEntries)
      .where(
        and(
          eq(schema.cmsEntries.orgId, org.id),
          eq(schema.cmsEntries.collectionId, collection.id),
          eq(schema.cmsEntries.id, payload.entryId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || row.slug !== entrySlug || (locale && row.locale !== locale)) {
      throw new NotFoundException(`cms_not_found: entry ${entrySlug}`);
    }

    res.setHeader('cache-control', 'no-store');
    const body = await this.renderEntry(org.id, collection, row, include, {
      publishedOnly: false,
    });
    return { ...body, status: row.status };
  }

  private async fetchLocaleAlternates(
    orgId: string,
    row: typeof schema.cmsEntries.$inferSelect,
  ): Promise<Array<{ locale: string; slug: string }>> {
    const rows = await this.db
      .select({ locale: schema.cmsEntries.locale, slug: schema.cmsEntries.slug })
      .from(schema.cmsEntries)
      .where(
        and(
          eq(schema.cmsEntries.orgId, orgId),
          eq(schema.cmsEntries.translationGroupId, row.translationGroupId),
          eq(schema.cmsEntries.status, 'published'),
        ),
      )
      .orderBy(schema.cmsEntries.locale);
    return rows;
  }

  private async fetchLocaleAlternatesBatch(
    orgId: string,
    translationGroupIds: string[],
  ): Promise<Map<string, Array<{ locale: string; slug: string }>>> {
    const byGroup = new Map<string, Array<{ locale: string; slug: string }>>();
    const groupIds = [...new Set(translationGroupIds)];
    if (groupIds.length === 0) return byGroup;
    const rows = await this.db
      .select({
        translationGroupId: schema.cmsEntries.translationGroupId,
        locale: schema.cmsEntries.locale,
        slug: schema.cmsEntries.slug,
      })
      .from(schema.cmsEntries)
      .where(
        and(
          eq(schema.cmsEntries.orgId, orgId),
          inArray(schema.cmsEntries.translationGroupId, groupIds),
          eq(schema.cmsEntries.status, 'published'),
        ),
      )
      .orderBy(schema.cmsEntries.locale);
    for (const r of rows) {
      const existing = byGroup.get(r.translationGroupId);
      if (existing) existing.push({ locale: r.locale, slug: r.slug });
      else byGroup.set(r.translationGroupId, [{ locale: r.locale, slug: r.slug }]);
    }
    return byGroup;
  }

  private async renderEntry(
    orgId: string,
    collection: typeof schema.cmsCollections.$inferSelect,
    row: typeof schema.cmsEntries.$inferSelect,
    include: string | undefined,
    opts: { publishedOnly: boolean },
  ) {
    const fields = collection.fields as FieldDef[];
    const projected = projectData(fields, row.data);
    const assets = await this.fetchAssets(orgId, fields, [projected]);
    const expanded = applyAssetExpansion(fields, projected, assets);
    const assetSidecar = buildInlineAssetSidecar(fields, expanded, assets);
    let data = rewriteInlineAssets(fields, expanded, assets);
    let refSidecar: Record<string, unknown> = {};
    if (includeReferences(include)) {
      const entryMap = await this.fetchReferencedEntries(orgId, fields, [data], opts);
      refSidecar = buildReferenceSidecar(fields, data, entryMap);
      data = applyReferenceExpansion(fields, data, entryMap);
    }
    const locales = await this.fetchLocaleAlternates(orgId, row);
    return {
      slug: row.slug,
      locale: row.locale,
      data,
      ...(Object.keys(assetSidecar).length > 0 ? { _assets: assetSidecar } : {}),
      ...(Object.keys(refSidecar).length > 0 ? { _refs: refSidecar } : {}),
      ...(locales.length > 0 ? { _locales: locales } : {}),
      version: row.version,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async fetchAssets(
    orgId: string,
    fields: FieldDef[],
    datas: Array<Record<string, unknown>>,
  ) {
    const ids = new Set<string>();
    for (const data of datas) {
      for (const id of collectAssetIds(fields, data)) ids.add(id);
    }
    return loadAssetMap(this.db, orgId, ids);
  }

  private async fetchReferencedEntries(
    orgId: string,
    fields: FieldDef[],
    datas: Array<Record<string, unknown>>,
    opts: { publishedOnly: boolean },
  ) {
    const ids = new Set<string>();
    for (const data of datas) {
      for (const id of collectReferenceIds(fields, data)) ids.add(id);
      for (const id of collectInlineReferenceIds(fields, data)) ids.add(id);
    }
    return loadEntryMap(this.db, orgId, ids, { publishedOnly: opts.publishedOnly });
  }

  private async resolveOrg(orgId: string): Promise<{ id: string }> {
    const rows = await this.db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .where(eq(schema.orgs.id, orgId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`cms_not_found: org ${orgId}`);
    return rows[0];
  }

  private async resolveOrgCollection(
    orgId: string,
    collectionSlug: string,
  ): Promise<{
    org: { id: string };
    collection: typeof schema.cmsCollections.$inferSelect;
  }> {
    const org = await this.resolveOrg(orgId);
    const rows = await this.db
      .select()
      .from(schema.cmsCollections)
      .where(
        and(eq(schema.cmsCollections.orgId, org.id), eq(schema.cmsCollections.slug, collectionSlug)),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`cms_not_found: collection ${collectionSlug}`);
    return { org, collection: rows[0] };
  }
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function computeEtag(updatedAtMs: number[]): string {
  if (updatedAtMs.length === 0) return '"empty"';
  return `"${Math.max(...updatedAtMs).toString(36)}-${updatedAtMs.length}"`;
}

function handleEtag(req: Request, res: Response, etag: string): boolean {
  res.setHeader('etag', etag);
  const incoming = req.headers['if-none-match'];
  if (typeof incoming === 'string' && incoming === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

function setCdnHeaders(res: Response): void {
  res.setHeader('cache-control', 'public, max-age=60, stale-while-revalidate=600');
}

function includeReferences(include: string | undefined): boolean {
  if (!include) return false;
  const parts = include.split(',').map((s) => s.trim());
  return parts.includes('references') || parts.includes('*');
}

function trackingEnabled(flag: string | undefined): boolean {
  if (!process.env.MUNIN_KEY_PEPPER) return false;
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  return true;
}

function buildTracking(
  orgId: string,
  entryId: string,
): { token: string; pixelUrl: string; beaconUrl: string } | undefined {
  try {
    const token = signViewToken({ orgId, subjectType: 'cms_entry', subjectId: entryId });
    const base = readApiBaseUrl();
    return {
      token,
      pixelUrl: `${base}/v1/a/v/${token}.gif`,
      beaconUrl: `${base}/v1/a/v`,
    };
  } catch {
    return undefined;
  }
}

