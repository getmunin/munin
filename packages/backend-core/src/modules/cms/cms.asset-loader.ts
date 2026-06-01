import { schema, type Db, type Tx } from '@getmunin/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { AssetSummary } from './cms.fields.ts';

export async function loadAssetMap(
  db: Db | Tx,
  orgId: string,
  ids: Iterable<string>,
): Promise<Map<string, AssetSummary>> {
  const list = [...new Set(ids)];
  if (list.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.cmsAssets.id,
      publicUrl: schema.cmsAssets.publicUrl,
      altText: schema.cmsAssets.altText,
      mime: schema.cmsAssets.mime,
      sizeBytes: schema.cmsAssets.sizeBytes,
      uploaded: schema.cmsAssets.uploaded,
    })
    .from(schema.cmsAssets)
    .where(and(eq(schema.cmsAssets.orgId, orgId), inArray(schema.cmsAssets.id, list)));
  const map = new Map<string, AssetSummary>();
  for (const r of rows) {
    if (!r.uploaded) continue;
    map.set(r.id, {
      id: r.id,
      publicUrl: r.publicUrl,
      altText: r.altText,
      mime: r.mime,
      sizeBytes: r.sizeBytes,
    });
  }
  return map;
}
