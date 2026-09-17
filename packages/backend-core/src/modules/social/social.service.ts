import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { makeId, schema } from '@getmunin/db';
import { getCurrentContext } from '@getmunin/core';
import {
  SOCIAL_PLATFORM_DESCRIPTORS,
  applyUtm,
  buildUtm,
  describePlatform,
  measureBody,
  type SocialDraftStatus,
  type SocialPlatform,
  type SocialPlatformDescriptor,
} from './social-platform.ts';

export interface SocialDraftDto {
  id: string;
  platform: SocialPlatform;
  setId: string;
  variantLabel: string;
  body: string;
  linkUrl: string | null;
  shareUrl: string | null;
  sourceRef: Record<string, unknown>;
  suggestedUserId: string | null;
  status: SocialDraftStatus;
  bodyChars: number;
  maxBodyChars: number;
  composerUrl: string;
  externalPostId: string | null;
  permalink: string | null;
  decidedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface CreateDraftInput {
  platform?: SocialPlatform;
  body: string;
  linkUrl?: string | null;
  variantLabel?: string;
  sourceRef?: Record<string, unknown>;
  suggestedUserId?: string | null;
  setId?: string;
}

export interface ProposeSetInput {
  platform?: SocialPlatform;
  linkUrl?: string | null;
  sourceRef?: Record<string, unknown>;
  suggestedUserId?: string | null;
  variants: { variantLabel: string; body: string }[];
}

export interface ListDraftsInput {
  platform?: SocialPlatform;
  status?: SocialDraftStatus;
  setId?: string;
  limit?: number;
}

const DEFAULT_PLATFORM: SocialPlatform = 'linkedin';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_VARIANTS = 8;

@Injectable()
export class SocialService {
  listPlatforms(): SocialPlatformDescriptor[] {
    return Object.values(SOCIAL_PLATFORM_DESCRIPTORS);
  }

  async createDraft(input: CreateDraftInput): Promise<SocialDraftDto> {
    const platform = input.platform ?? DEFAULT_PLATFORM;
    const setId = input.setId ?? makeId('spd');
    const rows = await this.insertVariants(platform, setId, input.linkUrl ?? null, {
      sourceRef: input.sourceRef ?? { type: 'adhoc' },
      suggestedUserId: input.suggestedUserId ?? null,
      variants: [{ variantLabel: input.variantLabel ?? 'single', body: input.body }],
    });
    return rows[0]!;
  }

  async proposeSet(input: ProposeSetInput): Promise<SocialDraftDto[]> {
    if (input.variants.length === 0) {
      throw new BadRequestException('social_invalid: a set needs at least one variant');
    }
    if (input.variants.length > MAX_VARIANTS) {
      throw new BadRequestException(
        `social_invalid: a set holds at most ${MAX_VARIANTS} variants, got ${input.variants.length}`,
      );
    }
    const labels = input.variants.map((variant) => variant.variantLabel);
    const duplicate = labels.find((label, index) => labels.indexOf(label) !== index);
    if (duplicate) {
      throw new ConflictException(
        `social_conflict: variant label ${duplicate} appears twice in the same set`,
      );
    }
    const platform = input.platform ?? DEFAULT_PLATFORM;
    return await this.insertVariants(platform, makeId('spd'), input.linkUrl ?? null, {
      sourceRef: input.sourceRef ?? { type: 'adhoc' },
      suggestedUserId: input.suggestedUserId ?? null,
      variants: input.variants,
    });
  }

  private async insertVariants(
    platform: SocialPlatform,
    setId: string,
    linkUrl: string | null,
    rest: {
      sourceRef: Record<string, unknown>;
      suggestedUserId: string | null;
      variants: { variantLabel: string; body: string }[];
    },
  ): Promise<SocialDraftDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    if (linkUrl !== null) this.assertHttpUrl(linkUrl);
    if (rest.suggestedUserId) await this.assertMember(rest.suggestedUserId);

    for (const variant of rest.variants) {
      if (!variant.body.trim()) {
        throw new BadRequestException('social_invalid: draft body cannot be empty');
      }
      if (!variant.variantLabel.trim()) {
        throw new BadRequestException('social_invalid: variant label cannot be empty');
      }
      const measured = measureBody(platform, variant.body, linkUrl);
      if (measured.overBy > 0) {
        throw new BadRequestException(
          `social_invalid: ${variant.variantLabel} is ${measured.overBy} characters over the ${describePlatform(platform).displayName} limit of ${measured.maxBodyChars}`,
        );
      }
      if (measured.linkCount > measured.maxLinks) {
        throw new BadRequestException(
          `social_invalid: ${variant.variantLabel} carries ${measured.linkCount} links, ${describePlatform(platform).displayName} allows ${measured.maxLinks}`,
        );
      }
    }

    const values = rest.variants.map((variant) => ({
      id: makeId('spd'),
      orgId: actor.orgId,
      platform,
      setId,
      variantLabel: variant.variantLabel,
      body: variant.body,
      linkUrl,
      linkUtm: linkUrl ? { ...buildUtm(platform, setId, variant.variantLabel) } : {},
      sourceRef: rest.sourceRef,
      suggestedUserId: rest.suggestedUserId,
      proposedByActorType: actor.type,
      proposedByActorId: actor.id,
    }));

    const inserted = await ctx.db.insert(schema.socialPostDrafts).values(values).returning();
    return inserted.map((row) => this.toDto(row));
  }

  async listDrafts(input: ListDraftsInput = {}): Promise<SocialDraftDto[]> {
    const ctx = getCurrentContext();
    const conditions = [eq(schema.socialPostDrafts.orgId, ctx.actor!.orgId)];
    if (input.platform) conditions.push(eq(schema.socialPostDrafts.platform, input.platform));
    if (input.status) conditions.push(eq(schema.socialPostDrafts.status, input.status));
    if (input.setId) conditions.push(eq(schema.socialPostDrafts.setId, input.setId));
    const rows = await ctx.db
      .select()
      .from(schema.socialPostDrafts)
      .where(and(...conditions))
      .orderBy(desc(schema.socialPostDrafts.createdAt))
      .limit(Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    return rows.map((row) => this.toDto(row));
  }

  async getDraft(id: string): Promise<SocialDraftDto> {
    return this.toDto(await this.requireDraft(id));
  }

  async reviseDraft(id: string, body: string): Promise<SocialDraftDto> {
    const ctx = getCurrentContext();
    const row = await this.requireDraft(id);
    this.assertPending(row);
    if (!body.trim()) {
      throw new BadRequestException('social_invalid: draft body cannot be empty');
    }
    const platform = row.platform as SocialPlatform;
    const measured = measureBody(platform, body, row.linkUrl);
    if (measured.overBy > 0) {
      throw new BadRequestException(
        `social_invalid: revision is ${measured.overBy} characters over the ${describePlatform(platform).displayName} limit of ${measured.maxBodyChars}`,
      );
    }
    const updated = await ctx.db
      .update(schema.socialPostDrafts)
      .set({ body, updatedAt: new Date() })
      .where(eq(schema.socialPostDrafts.id, id))
      .returning();
    return this.toDto(updated[0]!);
  }

  async dismissDraft(id: string): Promise<{ dismissed: true; id: string }> {
    const row = await this.requireDraft(id);
    this.assertPending(row);
    await this.decide(id, 'dismissed', {});
    return { dismissed: true, id };
  }

  async markPosted(id: string, permalink?: string | null): Promise<SocialDraftDto> {
    const row = await this.requireDraft(id);
    this.assertPending(row);
    if (permalink) this.assertHttpUrl(permalink);
    const updated = await this.decide(id, 'published_externally', {
      publishedAt: new Date(),
      permalink: permalink ?? null,
    });
    return this.toDto(updated);
  }

  private async decide(
    id: string,
    status: SocialDraftStatus,
    extra: Partial<typeof schema.socialPostDrafts.$inferInsert>,
  ) {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const updated = await ctx.db
      .update(schema.socialPostDrafts)
      .set({
        status,
        decidedByActorType: actor.type,
        decidedByActorId: actor.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
        ...extra,
      })
      .where(eq(schema.socialPostDrafts.id, id))
      .returning();
    return updated[0]!;
  }

  private async requireDraft(id: string) {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.socialPostDrafts)
      .where(
        and(eq(schema.socialPostDrafts.id, id), eq(schema.socialPostDrafts.orgId, ctx.actor!.orgId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException(`social_not_found: no draft with id ${id}`);
    return row;
  }

  private assertPending(row: typeof schema.socialPostDrafts.$inferSelect): void {
    if (row.status !== 'pending') {
      throw new ConflictException(
        `social_conflict: draft ${row.id} is already ${row.status} and can no longer be changed`,
      );
    }
  }

  private assertHttpUrl(value: string): void {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(`social_invalid: ${value} is not a valid URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('social_invalid: links must be http or https');
    }
  }

  private async assertMember(userId: string): Promise<void> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ userId: schema.orgMembers.userId })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.orgId, ctx.actor!.orgId),
          inArray(schema.orgMembers.userId, [userId]),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new BadRequestException(
        `social_invalid: ${userId} is not a member of this organisation`,
      );
    }
  }

  private toDto(row: typeof schema.socialPostDrafts.$inferSelect): SocialDraftDto {
    const platform = row.platform as SocialPlatform;
    const descriptor = describePlatform(platform);
    const measured = measureBody(platform, row.body, row.linkUrl);
    const utm = row.linkUtm;
    const shareUrl =
      row.linkUrl && utm.utm_source
        ? applyUtm(row.linkUrl, {
            utm_source: utm.utm_source,
            utm_medium: utm.utm_medium!,
            utm_campaign: utm.utm_campaign!,
            utm_content: utm.utm_content!,
          })
        : row.linkUrl;
    return {
      id: row.id,
      platform,
      setId: row.setId,
      variantLabel: row.variantLabel,
      body: row.body,
      linkUrl: row.linkUrl,
      shareUrl,
      sourceRef: row.sourceRef,
      suggestedUserId: row.suggestedUserId,
      status: row.status as SocialDraftStatus,
      bodyChars: measured.countedChars,
      maxBodyChars: measured.maxBodyChars,
      composerUrl: descriptor.composerUrl,
      externalPostId: row.externalPostId,
      permalink: row.permalink,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
