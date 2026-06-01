import {
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
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { PublicController } from '../common/auth/auth.guard.ts';
import { DB } from '../common/db/db.module.ts';
import { CmsSearchService } from '../modules/cms/cms.search.ts';
import { projectData, type FieldDef } from '../modules/cms/cms.fields.ts';

/**
 * Public delivery API — anonymous JSON for external websites / mobile
 * apps / external integrations. Routes open with `{orgId}` so a CDN can
 * cache cleanly per (org, collection) without per-request auth.
 *
 * Always returns `status='published'`. Drafts and scheduled entries
 * are visible only via the admin MCP surface or `/preview`.
 *
 * Service-role DB is used because RLS only knows the GUC-scoped tenant
 * context, and there's no auth here. Every SELECT hard-filters
 * `org_id` and `status='published'` so cross-org leakage is impossible.
 */
@PublicController('v1/cms', { throttle: true })
export class CmsDeliveryController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CmsSearchService) private readonly search: CmsSearchService,
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
  ) {
    if (!q || !q.trim()) return [];
    const org = await this.resolveOrg(orgId);
    return this.search.search(
      {
        query: q,
        collection,
        locale,
        limit: limit ? Number.parseInt(limit, 10) : undefined,
        publishedOnly: true,
      },
      { orgId: org.id },
    );
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
    const items = rows.map((r) => ({
      slug: r.slug,
      locale: r.locale,
      data: projectData(fields, r.data),
      version: r.version,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));

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
  ) {
    const { org, collection } = await this.resolveOrgCollection(orgId, collectionSlug);
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

    const fields = collection.fields as FieldDef[];
    const etag = computeEtag([row.updatedAt.getTime()]);
    if (handleEtag(req, res, etag)) return;
    setCdnHeaders(res);
    return {
      slug: row.slug,
      locale: row.locale,
      data: projectData(fields, row.data),
      version: row.version,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ─── helpers ─────────────────────────────────────────────────────────

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

