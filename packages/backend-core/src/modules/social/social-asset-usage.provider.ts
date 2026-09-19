import { Injectable } from '@nestjs/common';
import { getCurrentContext } from '@getmunin/core';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import type { AssetUsageProvider, AssetUsageRef } from '../../common/asset-usage/asset-usage.registry.ts';

@Injectable()
export class SocialAssetUsageProvider implements AssetUsageProvider {
  async usageFor(args: { assetId: string; publicUrl: string }): Promise<AssetUsageRef[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({
        id: schema.socialPostDrafts.id,
        platform: schema.socialPostDrafts.platform,
        variantLabel: schema.socialPostDrafts.variantLabel,
      })
      .from(schema.socialPostDrafts)
      .where(
        and(
          eq(schema.socialPostDrafts.orgId, ctx.actor!.orgId),
          eq(schema.socialPostDrafts.status, 'pending'),
          eq(schema.socialPostDrafts.mediaUrl, args.publicUrl),
        ),
      );
    return rows.map((row) => ({
      kind: 'social_draft',
      id: row.id,
      description: `pending ${row.platform} post draft ${row.id}`,
    }));
  }
}
