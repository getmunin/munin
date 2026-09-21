import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { makeId, schema, type Db, type Tx } from '@getmunin/db';
import {
  WebhookDispatcher,
  getCurrentContext,
  withContext,
  type RequestContext,
} from '@getmunin/core';
import { OutboundOAuthStore } from '../../common/outbound-oauth/grant-store.ts';
import { SocialAccountsService } from './social-accounts.service.ts';
import {
  SocialOAuthRegistry,
  type SocialMediaRef,
  type SocialMediaUpload,
  type SocialPublishRequest,
  type SocialPublishResult,
} from './social-oauth.ts';
import {
  decidedBefore,
  toDecidedActor,
  type DecidedQuery,
  type ReviewDecision,
  type ReviewDecisionOutcome,
} from '../../common/review-decision.ts';
import { socialDraftFingerprint } from './social-fingerprint.ts';
import {
  SOCIAL_PLATFORM_DESCRIPTORS,
  buildUtm,
  describePlatform,
  measureBody,
  shareUrlFor,
  SOCIAL_LINK_PLACEMENTS,
  SOCIAL_MEDIA_KINDS,
  type SocialAuthorKind,
  type SocialDraftStatus,
  type SocialLinkPlacement,
  type SocialMediaKind,
  type SocialPlatform,
  type SocialPlatformDescriptor,
} from './social-platform.ts';
import {
  SocialMediaFetcher,
  type FetchedMedia,
  type SocialMediaReader,
} from './social-media.ts';

export interface SocialPublishTarget {
  userId: string;
  platform: SocialPlatform;
  authorKind: SocialAuthorKind;
  externalAccountId: string;
  displayName: string | null;
}

export interface SocialTokenSource {
  accessTokenFor(args: {
    userId: string;
    orgId: string;
    platform: SocialPlatform;
  }): Promise<string>;
}

export interface SocialPublisherLookup {
  get(platform: SocialPlatform):
    | {
        publish?: (args: SocialPublishRequest) => Promise<SocialPublishResult>;
        uploadMedia?: (args: {
          accessToken: string;
          externalAccountId: string;
          media: SocialMediaUpload;
        }) => Promise<SocialMediaRef>;
      }
    | undefined;
}

export interface SocialEventEmitter {
  emit(input: { type: string; payload: Record<string, unknown> }): Promise<string>;
}

export interface RootTransactionRunner {
  inRootTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface SocialDraftDto {
  id: string;
  platform: SocialPlatform;
  setId: string;
  variantLabel: string;
  body: string;
  linkUrl: string | null;
  shareUrl: string | null;
  linkPlacement: SocialLinkPlacement;
  linkCommentText: string | null;
  mediaUrl: string | null;
  mediaKind: SocialMediaKind | null;
  mediaAltText: string | null;
  sourceRef: Record<string, unknown>;
  status: SocialDraftStatus;
  bodyChars: number;
  maxBodyChars: number;
  canPublish: boolean;
  composerUrl: string;
  externalPostId: string | null;
  permalink: string | null;
  commentExternalId: string | null;
  commentError: string | null;
  decidedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface DraftPresentationInput {
  linkPlacement?: SocialLinkPlacement;
  linkCommentText?: string | null;
  mediaUrl?: string | null;
  mediaKind?: SocialMediaKind | null;
  mediaAltText?: string | null;
}

export interface CreateDraftInput extends DraftPresentationInput {
  platform?: SocialPlatform;
  body: string;
  linkUrl?: string | null;
  variantLabel?: string;
  sourceRef?: Record<string, unknown>;
  setId?: string;
}

export interface ProposeSetInput extends DraftPresentationInput {
  platform?: SocialPlatform;
  linkUrl?: string | null;
  sourceRef?: Record<string, unknown>;
  variants: { variantLabel: string; body: string }[];
}

export interface ListDraftsInput {
  platform?: SocialPlatform;
  status?: SocialDraftStatus;
  setId?: string;
  limit?: number;
}

interface ResolvedPresentation {
  linkPlacement: SocialLinkPlacement;
  linkCommentText: string | null;
  mediaUrl: string | null;
  mediaKind: SocialMediaKind | null;
  mediaAltText: string | null;
}

export function bodyLink(linkUrl: string | null, linkPlacement: string): string | null {
  return linkPlacement === 'comment' ? null : linkUrl;
}

export function linkAlreadyInBody(
  body: string,
  linkUrl: string | null,
  linkPlacement: string,
): boolean {
  if (linkPlacement !== 'comment' || !linkUrl) return false;
  return body.includes(linkUrl);
}

const DEFAULT_PLATFORM: SocialPlatform = 'linkedin';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_VARIANTS = 8;

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @Inject(SocialAccountsService) private readonly accounts: SocialTokenSource,
    @Inject(SocialOAuthRegistry) private readonly registry: SocialPublisherLookup,
    @Inject(OutboundOAuthStore) private readonly store: RootTransactionRunner,
    @Inject(WebhookDispatcher) private readonly webhooks: SocialEventEmitter,
    @Inject(SocialMediaFetcher) private readonly media: SocialMediaReader,
  ) {}

  listPlatforms(): SocialPlatformDescriptor[] {
    return Object.values(SOCIAL_PLATFORM_DESCRIPTORS);
  }

  async createDraft(input: CreateDraftInput): Promise<SocialDraftDto> {
    const platform = input.platform ?? DEFAULT_PLATFORM;
    const setId = input.setId ?? makeId('spd');
    const rows = await this.insertVariants(platform, setId, input.linkUrl ?? null, {
      sourceRef: input.sourceRef ?? { type: 'adhoc' },
      presentation: this.readPresentation(platform, input, input.linkUrl ?? null),
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
      presentation: this.readPresentation(platform, input, input.linkUrl ?? null),
      variants: input.variants,
    });
  }

  private async insertVariants(
    platform: SocialPlatform,
    setId: string,
    linkUrl: string | null,
    rest: {
      sourceRef: Record<string, unknown>;
      presentation: ResolvedPresentation;
      variants: { variantLabel: string; body: string }[];
    },
  ): Promise<SocialDraftDto[]> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;

    if (linkUrl !== null) this.assertHttpUrl(linkUrl);

    for (const variant of rest.variants) {
      if (!variant.body.trim()) {
        throw new BadRequestException('social_invalid: draft body cannot be empty');
      }
      if (!variant.variantLabel.trim()) {
        throw new BadRequestException('social_invalid: variant label cannot be empty');
      }
      this.assertLinkNotInBody(
        variant.variantLabel,
        variant.body,
        linkUrl,
        rest.presentation.linkPlacement,
      );
      const measured = measureBody(platform, variant.body, bodyLink(linkUrl, rest.presentation.linkPlacement));
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
      linkPlacement: rest.presentation.linkPlacement,
      linkCommentText: rest.presentation.linkCommentText,
      mediaUrl: rest.presentation.mediaUrl,
      mediaKind: rest.presentation.mediaKind,
      mediaAltText: rest.presentation.mediaAltText,
      sourceRef: rest.sourceRef,
      proposedByActorType: actor.type,
      proposedByActorId: actor.id,
    }));

    const inserted = await ctx.db.insert(schema.socialPostDrafts).values(values).returning();
    for (const row of inserted) {
      await this.webhooks.emit({
        type: 'social.post_draft.proposed',
        payload: this.eventPayload(row),
      });
    }
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
    this.assertLinkNotInBody('the revision', body, row.linkUrl, row.linkPlacement);
    const measured = measureBody(platform, body, bodyLink(row.linkUrl, row.linkPlacement));
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
    await this.webhooks.emit({
      type: 'social.post_draft.revised',
      payload: this.eventPayload(updated[0]!),
    });
    return this.toDto(updated[0]!);
  }

  async dismissDraft(id: string, reason?: string | null): Promise<{ dismissed: true; id: string }> {
    const row = await this.requireDraft(id);
    this.assertPending(row);
    const updated = await this.decide(id, 'dismissed', { dismissReason: reason?.trim() || null });
    await this.webhooks.emit({
      type: 'social.post_draft.dismissed',
      payload: { ...this.eventPayload(updated), reason: updated.dismissReason },
    });
    return { dismissed: true, id };
  }

  async listDecided(input: DecidedQuery): Promise<ReviewDecision<SocialDraftDto>[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select({ item: schema.socialPostDrafts, decidedByName: schema.users.name })
      .from(schema.socialPostDrafts)
      .leftJoin(
        schema.users,
        and(
          eq(schema.socialPostDrafts.decidedByActorType, 'user'),
          eq(schema.users.id, schema.socialPostDrafts.decidedByActorId),
        ),
      )
      .where(
        and(
          eq(schema.socialPostDrafts.orgId, ctx.actor!.orgId),
          inArray(schema.socialPostDrafts.status, [
            'published',
            'published_externally',
            'dismissed',
            'failed',
          ]),
          isNotNull(schema.socialPostDrafts.decidedAt),
          decidedBefore(
            schema.socialPostDrafts.decidedAt,
            schema.socialPostDrafts.id,
            input.cursor,
          ),
        ),
      )
      .orderBy(desc(schema.socialPostDrafts.decidedAt), desc(schema.socialPostDrafts.id))
      .limit(Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));

    return rows.flatMap(({ item, decidedByName }) => {
      if (!item.decidedAt) return [];
      return [
        {
          id: item.id,
          decidedAt: item.decidedAt.toISOString(),
          outcome: decidedOutcome(item.status as SocialDraftStatus),
          reason: item.status === 'failed' ? item.lastError : item.dismissReason,
          decidedBy: toDecidedActor(
            item.decidedByActorType,
            item.decidedByActorId,
            decidedByName,
          ),
          producedRef: null,
          raw: this.toDto(item),
        },
      ];
    });
  }

  async publishTargetsForViewer(): Promise<SocialPublishTarget[]> {
    const ctx = getCurrentContext();
    const userId = ctx.actor!.userId;
    if (!userId) return [];
    const rows = await ctx.db
      .select({
        userId: schema.socialAccounts.userId,
        platform: schema.socialAccounts.platform,
        authorKind: schema.socialAccounts.authorKind,
        externalAccountId: schema.socialAccounts.externalAccountId,
        displayName: schema.socialAccounts.displayName,
      })
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.orgId, ctx.actor!.orgId),
          eq(schema.socialAccounts.userId, userId),
          eq(schema.socialAccounts.status, 'active'),
        ),
      );
    return rows.map((row) => ({
      ...row,
      platform: row.platform as SocialPlatform,
      authorKind: row.authorKind as SocialAuthorKind,
    }));
  }

  async publishDraft(
    id: string,
    opts: { fingerprint?: string | null } = {},
  ): Promise<SocialDraftDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const row = await this.requireDraft(id);
    this.assertPending(row);
    this.assertFingerprint(row, opts.fingerprint);

    const platform = row.platform as SocialPlatform;
    const adapter = this.registry.get(platform);
    const publish = adapter?.publish?.bind(adapter);
    if (!publish) {
      throw new BadRequestException({
        message: `social_publish_unsupported: Munin cannot post to ${describePlatform(platform).displayName} on your behalf — publish it yourself and mark the draft posted`,
        code: 'social_publish_unsupported',
      });
    }

    const userId = actor.userId;
    if (!userId) {
      throw new BadRequestException({
        message:
          'social_publish_needs_person: a post is published from a person\'s own connected account, so it cannot be published by a service key',
        code: 'social_publish_needs_person',
      });
    }

    const account = await this.requirePublishableAccount(userId, platform);
    const accessToken = await this.accounts.accessTokenFor({
      userId,
      orgId: actor.orgId,
      platform,
    });
    const linkUrl = this.toDto(row).shareUrl;
    const uploadMedia = adapter?.uploadMedia?.bind(adapter);
    let media: SocialMediaRef | null = null;
    if (uploadMedia) {
      try {
        media = await this.resolveMedia(row, platform, (upload) =>
          uploadMedia({
            accessToken,
            externalAccountId: account.externalAccountId,
            media: upload,
          }),
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'the media could not be attached';
        throw new BadRequestException({
          message: `social_media_failed: ${reason}`,
          code: 'social_media_failed',
        });
      }
    }

    const outcome = await this.store.inRootTransaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.socialPostDrafts)
        .where(
          and(
            eq(schema.socialPostDrafts.id, id),
            eq(schema.socialPostDrafts.orgId, actor.orgId),
          ),
        )
        .for('update')
        .limit(1);
      if (!locked) throw new NotFoundException(`social_not_found: no draft with id ${id}`);
      if (locked.status !== 'pending') {
        throw new ConflictException(
          `social_conflict: draft ${id} is already ${locked.status} and can no longer be changed`,
        );
      }
      this.assertFingerprint(locked, opts.fingerprint);

      const emit = (type: string, payload: Record<string, unknown>) => {
        const inner: RequestContext = { db: tx, actor, correlationId: ctx.correlationId };
        return withContext(inner, () => this.webhooks.emit({ type, payload }));
      };

      const decided = {
        decidedByActorType: actor.type,
        decidedByActorId: actor.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      };

      try {
        const result = await publish({
          accessToken,
          externalAccountId: account.externalAccountId,
          body: locked.body,
          linkUrl,
          linkPlacement: locked.linkPlacement as SocialLinkPlacement,
          linkCommentText: locked.linkCommentText,
          media,
        });
        const [updated] = await tx
          .update(schema.socialPostDrafts)
          .set({
            ...decided,
            status: 'published',
            publishedAt: new Date(),
            externalPostId: result.externalPostId,
            permalink: result.permalink,
            commentExternalId: result.commentExternalId,
            commentError: result.commentError ? result.commentError.slice(0, 500) : null,
            lastError: null,
          })
          .where(eq(schema.socialPostDrafts.id, id))
          .returning();
        await emit('social.post_draft.published', {
          ...this.eventPayload(updated!),
          publishedExternally: false,
          commentExternalId: updated!.commentExternalId,
          commentError: updated!.commentError,
        });
        await this.settleSiblings(tx, updated!, emit);
        return { published: updated! };
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'the platform refused the post';
        this.logger.warn(`publish refused platform=${locked.platform} draft=${id} reason=${reason}`);
        const [updated] = await tx
          .update(schema.socialPostDrafts)
          .set({ ...decided, status: 'failed', lastError: reason.slice(0, 500) })
          .where(eq(schema.socialPostDrafts.id, id))
          .returning();
        await emit('social.post_draft.failed', {
          ...this.eventPayload(updated!),
          reason: updated!.lastError,
        });
        return { failed: reason };
      }
    });

    if ('failed' in outcome) {
      throw new BadGatewayException({
        message: `social_publish_failed: ${outcome.failed}`,
        code: 'social_publish_failed',
      });
    }
    return this.toDto(outcome.published);
  }

  private readPresentation(
    platform: SocialPlatform,
    input: DraftPresentationInput,
    linkUrl: string | null,
  ): ResolvedPresentation {
    const descriptor = describePlatform(platform);
    const linkPlacement = input.linkPlacement ?? 'body';
    if (!SOCIAL_LINK_PLACEMENTS.includes(linkPlacement)) {
      throw new BadRequestException(
        `social_invalid: ${linkPlacement} is not a link placement — use ${SOCIAL_LINK_PLACEMENTS.join(' or ')}`,
      );
    }
    if (!descriptor.linkPlacements.includes(linkPlacement)) {
      throw new BadRequestException(
        `social_invalid: ${descriptor.displayName} cannot place a link in a ${linkPlacement}`,
      );
    }
    if (linkPlacement === 'comment' && !linkUrl) {
      throw new BadRequestException(
        'social_invalid: linkPlacement comment needs a linkUrl to put in the comment',
      );
    }
    const linkCommentText = input.linkCommentText?.trim() || null;
    if (linkCommentText && linkPlacement !== 'comment') {
      throw new BadRequestException(
        'social_invalid: linkCommentText only applies when linkPlacement is comment',
      );
    }
    const mediaUrl = input.mediaUrl?.trim() || null;
    const mediaKind = input.mediaKind ?? null;
    const mediaAltText = input.mediaAltText?.trim() || null;
    if (mediaUrl) this.assertHttpUrl(mediaUrl);
    if (mediaKind) {
      if (!SOCIAL_MEDIA_KINDS.includes(mediaKind)) {
        throw new BadRequestException(
          `social_invalid: ${mediaKind} is not a media kind — use ${SOCIAL_MEDIA_KINDS.join(' or ')}`,
        );
      }
      if (!descriptor.media.kinds.includes(mediaKind)) {
        throw new BadRequestException(
          `social_invalid: ${descriptor.displayName} does not take a ${mediaKind}`,
        );
      }
    }
    if (!mediaUrl && (mediaKind || mediaAltText)) {
      throw new BadRequestException(
        'social_invalid: mediaKind and mediaAltText need a mediaUrl to describe',
      );
    }
    return { linkPlacement, linkCommentText, mediaUrl, mediaKind, mediaAltText };
  }

  async setDraftMedia(
    id: string,
    input: { mediaUrl: string | null; mediaKind?: SocialMediaKind | null; mediaAltText?: string | null },
  ): Promise<SocialDraftDto> {
    const ctx = getCurrentContext();
    const row = await this.requireDraft(id);
    this.assertPending(row);
    const platform = row.platform as SocialPlatform;
    const presentation = this.readPresentation(
      platform,
      {
        linkPlacement: row.linkPlacement as SocialLinkPlacement,
        linkCommentText: row.linkCommentText,
        mediaUrl: input.mediaUrl,
        mediaKind: input.mediaKind ?? null,
        mediaAltText: input.mediaAltText ?? null,
      },
      row.linkUrl,
    );
    const [updated] = await ctx.db
      .update(schema.socialPostDrafts)
      .set({
        mediaUrl: presentation.mediaUrl,
        mediaKind: presentation.mediaKind,
        mediaAltText: presentation.mediaAltText,
        updatedAt: new Date(),
      })
      .where(eq(schema.socialPostDrafts.id, id))
      .returning();
    await this.webhooks.emit({
      type: 'social.post_draft.revised',
      payload: this.eventPayload(updated!),
    });
    return this.toDto(updated!);
  }

  async setDraftLinkPlacement(
    id: string,
    input: { linkPlacement: SocialLinkPlacement; linkCommentText?: string | null },
  ): Promise<SocialDraftDto> {
    const ctx = getCurrentContext();
    const row = await this.requireDraft(id);
    this.assertPending(row);
    const platform = row.platform as SocialPlatform;
    const presentation = this.readPresentation(
      platform,
      {
        linkPlacement: input.linkPlacement,
        linkCommentText: input.linkCommentText ?? null,
        mediaUrl: row.mediaUrl,
        mediaKind: row.mediaKind as SocialMediaKind | null,
        mediaAltText: row.mediaAltText,
      },
      row.linkUrl,
    );
    this.assertLinkNotInBody('the draft', row.body, row.linkUrl, presentation.linkPlacement);
    const measured = measureBody(
      platform,
      row.body,
      bodyLink(row.linkUrl, presentation.linkPlacement),
    );
    if (measured.overBy > 0) {
      throw new BadRequestException(
        `social_invalid: moving the link into the body puts the draft ${measured.overBy} characters over the ${describePlatform(platform).displayName} limit of ${measured.maxBodyChars}`,
      );
    }
    const [updated] = await ctx.db
      .update(schema.socialPostDrafts)
      .set({
        linkPlacement: presentation.linkPlacement,
        linkCommentText: presentation.linkCommentText,
        updatedAt: new Date(),
      })
      .where(eq(schema.socialPostDrafts.id, id))
      .returning();
    await this.webhooks.emit({
      type: 'social.post_draft.revised',
      payload: this.eventPayload(updated!),
    });
    return this.toDto(updated!);
  }

  private async resolveMedia(
    row: typeof schema.socialPostDrafts.$inferSelect,
    platform: SocialPlatform,
    upload: (media: SocialMediaUpload) => Promise<SocialMediaRef>,
  ): Promise<SocialMediaRef | null> {
    const descriptor = describePlatform(platform);
    const attach = (fetched: FetchedMedia) =>
      upload({
        kind: fetched.kind,
        bytes: fetched.bytes,
        contentType: fetched.contentType,
        altText: row.mediaAltText,
      });

    if (row.mediaUrl) {
      return await attach(
        await this.media.fetchMedia(row.mediaUrl, {
          expectedKind: row.mediaKind as SocialMediaKind | null,
          limits: descriptor.media,
        }),
      );
    }

    const scraped = await this.scrapeLinkImage(row.linkUrl, descriptor.media);
    if (!scraped) return null;
    try {
      return await attach(scraped);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'the upload was refused';
      this.logger.warn(`link preview image not attached draft=${row.id} reason=${reason}`);
      return null;
    }
  }

  private async scrapeLinkImage(
    linkUrl: string | null,
    limits: SocialPlatformDescriptor['media'],
  ): Promise<FetchedMedia | null> {
    if (!linkUrl) return null;
    try {
      const preview = await this.media.fetchOpenGraph(linkUrl);
      if (!preview.imageUrl) return null;
      return await this.media.fetchMedia(preview.imageUrl, { expectedKind: 'image', limits });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'the page could not be read';
      this.logger.warn(`link preview image unavailable link=${linkUrl} reason=${reason}`);
      return null;
    }
  }

  private async requirePublishableAccount(
    userId: string,
    platform: SocialPlatform,
  ): Promise<{ externalAccountId: string; displayName: string | null }> {
    const ctx = getCurrentContext();
    const [row] = await ctx.db
      .select({
        externalAccountId: schema.socialAccounts.externalAccountId,
        displayName: schema.socialAccounts.displayName,
        status: schema.socialAccounts.status,
      })
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.orgId, ctx.actor!.orgId),
          eq(schema.socialAccounts.userId, userId),
          eq(schema.socialAccounts.platform, platform),
        ),
      )
      .limit(1);
    const displayName = describePlatform(platform).displayName;
    if (!row) {
      throw new BadRequestException({
        message: `social_no_account: connect your ${displayName} account from Settings → Integrations before publishing`,
        code: 'social_no_account',
      });
    }
    if (row.status !== 'active') {
      throw new BadRequestException({
        message: `social_reconnect_required: your ${displayName} connection is ${row.status} — reconnect it from Settings → Integrations`,
        code: 'social_reconnect_required',
      });
    }
    return { externalAccountId: row.externalAccountId, displayName: row.displayName };
  }

  async markPosted(id: string, permalink?: string | null): Promise<SocialDraftDto> {
    const row = await this.requireDraft(id);
    this.assertPending(row);
    if (permalink) this.assertHttpUrl(permalink);
    const updated = await this.decide(id, 'published_externally', {
      publishedAt: new Date(),
      permalink: permalink ?? null,
    });
    await this.webhooks.emit({
      type: 'social.post_draft.published',
      payload: { ...this.eventPayload(updated), publishedExternally: true },
    });
    await this.settleSiblings(getCurrentContext().db, updated, (type, payload) =>
      this.webhooks.emit({ type, payload }),
    );
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

  private async settleSiblings(
    db: Db | Tx,
    published: typeof schema.socialPostDrafts.$inferSelect,
    emit: (type: string, payload: Record<string, unknown>) => Promise<unknown>,
  ): Promise<void> {
    const now = new Date();
    const siblings = await db
      .update(schema.socialPostDrafts)
      .set({
        status: 'dismissed',
        dismissReason: `superseded: variant ${published.variantLabel} was published instead`,
        decidedByActorType: published.decidedByActorType,
        decidedByActorId: published.decidedByActorId,
        decidedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.socialPostDrafts.orgId, published.orgId),
          eq(schema.socialPostDrafts.setId, published.setId),
          eq(schema.socialPostDrafts.status, 'pending'),
          ne(schema.socialPostDrafts.id, published.id),
        ),
      )
      .returning();
    for (const sibling of siblings) {
      await emit('social.post_draft.dismissed', {
        ...this.eventPayload(sibling),
        reason: sibling.dismissReason,
        supersededBy: published.id,
      });
    }
  }

  private assertFingerprint(
    row: typeof schema.socialPostDrafts.$inferSelect,
    fingerprint: string | null | undefined,
  ): void {
    if (!fingerprint) return;
    if (socialDraftFingerprint(row) === fingerprint) return;
    throw new ConflictException({
      message: `social_stale: draft ${row.id} changed after it was proposed — re-read it and publish the text you meant to publish`,
      code: 'social_stale',
    });
  }

  private eventPayload(
    row: typeof schema.socialPostDrafts.$inferSelect,
  ): Record<string, unknown> {
    return {
      draftId: row.id,
      platform: row.platform,
      setId: row.setId,
      variantLabel: row.variantLabel,
      status: row.status,
      linkUrl: row.linkUrl,
      shareUrl: shareUrlFor(row),
      linkPlacement: row.linkPlacement,
      mediaKind: row.mediaKind,
      permalink: row.permalink,
      externalPostId: row.externalPostId,
      fingerprint: socialDraftFingerprint(row),
    };
  }

  private assertPending(row: typeof schema.socialPostDrafts.$inferSelect): void {
    if (row.status !== 'pending') {
      throw new ConflictException(
        `social_conflict: draft ${row.id} is already ${row.status} and can no longer be changed`,
      );
    }
  }

  private assertLinkNotInBody(
    label: string,
    body: string,
    linkUrl: string | null,
    linkPlacement: string,
  ): void {
    if (!linkAlreadyInBody(body, linkUrl, linkPlacement)) return;
    throw new BadRequestException(
      `social_invalid: ${label} already carries the link in its text, so posting it as a comment as well would publish it twice — take the url out of the body or use linkPlacement body`,
    );
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

  private toDto(row: typeof schema.socialPostDrafts.$inferSelect): SocialDraftDto {
    const platform = row.platform as SocialPlatform;
    const descriptor = describePlatform(platform);
    const measured = measureBody(platform, row.body, bodyLink(row.linkUrl, row.linkPlacement));
    const shareUrl = shareUrlFor(row);
    return {
      id: row.id,
      platform,
      setId: row.setId,
      variantLabel: row.variantLabel,
      body: row.body,
      linkUrl: row.linkUrl,
      shareUrl,
      linkPlacement: row.linkPlacement as SocialLinkPlacement,
      linkCommentText: row.linkCommentText,
      mediaUrl: row.mediaUrl,
      mediaKind: row.mediaKind as SocialMediaKind | null,
      mediaAltText: row.mediaAltText,
      sourceRef: row.sourceRef,
      status: row.status as SocialDraftStatus,
      bodyChars: measured.countedChars,
      maxBodyChars: measured.maxBodyChars,
      canPublish: descriptor.canPublish,
      composerUrl: descriptor.composerUrl,
      externalPostId: row.externalPostId,
      permalink: row.permalink,
      commentExternalId: row.commentExternalId,
      commentError: row.commentError,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function decidedOutcome(status: SocialDraftStatus): ReviewDecisionOutcome {
  if (status === 'dismissed') return 'dismissed';
  if (status === 'failed') return 'failed';
  return 'approved';
}
