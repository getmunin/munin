import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import {
  SOCIAL_DRAFT_STATUSES,
  SOCIAL_LINK_PLACEMENTS,
  SOCIAL_MEDIA_KINDS,
  SOCIAL_PLATFORMS,
} from './social-platform.ts';
import { SocialService } from './social.service.ts';
import { SocialAccountsService } from './social-accounts.service.ts';

const PlatformField = z.enum(SOCIAL_PLATFORMS).optional();

const ListPlatformsInput = z.object({});

const ListAccountsInput = z.object({});

const ListDraftsInput = z.object({
  platform: PlatformField,
  status: z.enum(SOCIAL_DRAFT_STATUSES).optional(),
  setId: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const IdInput = z.object({ id: z.string() });

const PresentationFields = {
  linkPlacement: z
    .enum(SOCIAL_LINK_PLACEMENTS)
    .optional()
    .describe(
      'Where the link goes. "body" appends it to the post text. "comment" leaves it out of the post and publishes it as the first comment instead.',
    ),
  linkCommentText: z
    .string()
    .max(1000)
    .nullable()
    .optional()
    .describe('Wording for the link comment. The link is appended when the text omits it.'),
  mediaUrl: z
    .string()
    .url()
    .nullable()
    .optional()
    .describe(
      'Public https URL of an image or video to attach. Fetched at publish time and uploaded to the platform. When omitted, the image advertised by the linked page is used.',
    ),
  mediaKind: z.enum(SOCIAL_MEDIA_KINDS).nullable().optional(),
  mediaAltText: z.string().max(4000).nullable().optional(),
};

const SetMediaInput = z.object({
  id: z.string(),
  mediaUrl: z.string().url().nullable(),
  mediaKind: z.enum(SOCIAL_MEDIA_KINDS).nullable().optional(),
  mediaAltText: z.string().max(4000).nullable().optional(),
});

const SetLinkPlacementInput = z.object({
  id: z.string(),
  linkPlacement: z.enum(SOCIAL_LINK_PLACEMENTS),
  linkCommentText: z.string().max(1000).nullable().optional(),
});

const DismissInput = z.object({
  id: z.string(),
  reason: z.string().max(500).nullable().optional(),
});

const CreateDraftInput = z.object({
  body: z.string().min(1),
  platform: PlatformField,
  linkUrl: z.string().url().nullable().optional(),
  variantLabel: z.string().min(1).max(32).optional(),
  ...PresentationFields,
});

const ProposeSetInput = z.object({
  variants: z
    .array(z.object({ variantLabel: z.string().min(1).max(32), body: z.string().min(1) }))
    .min(1)
    .max(8),
  platform: PlatformField,
  linkUrl: z.string().url().nullable().optional(),
  sourceRef: z.record(z.string(), z.unknown()).optional(),
  ...PresentationFields,
});

const ReviseInput = z.object({ id: z.string(), body: z.string().min(1) });

const MarkPostedInput = z.object({
  id: z.string(),
  permalink: z.string().url().nullable().optional(),
});

@Injectable()
export class SocialTools {
  constructor(
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(SocialAccountsService) private readonly accounts: SocialAccountsService,
  ) {}

  @McpTool({
    name: 'social_list_platforms',
    title: 'Social: List platforms',
    description:
      'List the social platforms Munin can draft posts for, with the character and link limits each one enforces. Read this before writing draft bodies so they fit the platform they are destined for.',
    audiences: ['admin'],
    scopes: ['social:read'],
    input: ListPlatformsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  listPlatforms() {
    return { platforms: this.social.listPlatforms() };
  }

  @McpTool({
    name: 'social_list_connected_accounts',
    title: 'Social: List connected accounts',
    description:
      'List the people in this organisation who have connected a social account Munin can post from, with the platform, the account name, and whether the connection still works. Use it to answer whether anybody can publish at all, and whose grant is about to lapse — a draft that cannot be published by anyone sits in the review queue until it goes stale.',
    audiences: ['admin'],
    scopes: ['social:read'],
    input: ListAccountsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async listAccounts() {
    return { accounts: await this.accounts.listAccounts() };
  }

  @McpTool({
    name: 'social_list_post_drafts',
    title: 'Social: List post drafts',
    description:
      'List social post drafts for the org, newest first. Filter by platform, status, or the set id that groups the variants written for one article.',
    audiences: ['admin'],
    scopes: ['social:read'],
    input: ListDraftsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async listDrafts(args: z.infer<typeof ListDraftsInput>) {
    return { drafts: await this.social.listDrafts(args) };
  }

  @McpTool({
    name: 'social_get_post_draft',
    title: 'Social: Get post draft',
    description: 'Read a single social post draft by id, including its tracked share URL.',
    audiences: ['admin'],
    scopes: ['social:read'],
    input: IdInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  getDraft(args: z.infer<typeof IdInput>) {
    return this.social.getDraft(args.id);
  }

  @McpTool({
    name: 'social_create_post_draft',
    title: 'Social: Create post draft',
    description:
      'Store a single social post draft for a person to review and publish. Use this to hand over any piece of text meant for social, whether or not it relates to a published article. An image or video can be attached with mediaUrl, and the link can be placed in the first comment instead of the body.',
    audiences: ['admin'],
    scopes: ['social:write'],
    input: CreateDraftInput,
    destructiveHint: true,
  })
  createDraft(args: z.infer<typeof CreateDraftInput>) {
    return this.social.createDraft(args);
  }

  @McpTool({
    name: 'social_propose_post_set',
    title: 'Social: Propose a set of post variants',
    description:
      'Store several drafts of the same post as one reviewable set, each with its own label for the angle it takes. The link is tagged per variant so later click figures show which angle performed.',
    audiences: ['admin'],
    scopes: ['social:write'],
    input: ProposeSetInput,
    destructiveHint: true,
  })
  async proposeSet(args: z.infer<typeof ProposeSetInput>) {
    return { drafts: await this.social.proposeSet(args) };
  }

  @McpTool({
    name: 'social_update_post_draft',
    title: 'Social: Update post draft',
    description:
      'Replace the body of a draft that has not been decided yet. The platform character limit is re-checked against the new text.',
    audiences: ['admin'],
    scopes: ['social:write'],
    input: ReviseInput,
    destructiveHint: true,
  })
  reviseDraft(args: z.infer<typeof ReviseInput>) {
    return this.social.reviseDraft(args.id, args.body);
  }

  @McpTool({
    name: 'social_set_post_draft_media',
    title: 'Social: Set post draft media',
    description:
      'Attach an image or video to a draft that has not been decided yet, or clear the one it carries by passing a null mediaUrl. The file is fetched from the URL when the draft is published, not now, so the URL has to stay reachable until then. A draft with no media of its own falls back to the image the linked page advertises.',
    audiences: ['admin'],
    scopes: ['social:write'],
    input: SetMediaInput,
    destructiveHint: true,
  })
  setDraftMedia(args: z.infer<typeof SetMediaInput>) {
    return this.social.setDraftMedia(args.id, {
      mediaUrl: args.mediaUrl,
      mediaKind: args.mediaKind ?? null,
      mediaAltText: args.mediaAltText ?? null,
    });
  }

  @McpTool({
    name: 'social_set_post_draft_link_placement',
    title: 'Social: Set post draft link placement',
    description:
      'Move the link of a draft that has not been decided yet between the post body and the first comment. Posting the link as a comment keeps it out of the body, which is how many people publish links on LinkedIn; the post is published either way, and a comment the platform refuses is recorded on the draft rather than failing the post.',
    audiences: ['admin'],
    scopes: ['social:write'],
    input: SetLinkPlacementInput,
    destructiveHint: true,
  })
  setDraftLinkPlacement(args: z.infer<typeof SetLinkPlacementInput>) {
    return this.social.setDraftLinkPlacement(args.id, {
      linkPlacement: args.linkPlacement,
      linkCommentText: args.linkCommentText ?? null,
    });
  }

  @McpTool({
    name: 'social_dismiss_post_draft',
    title: 'Social: Dismiss post draft',
    description:
      'Close a draft nobody intends to publish, optionally recording why. Dismissing one variant leaves the rest of its set alone.',
    audiences: ['admin'],
    scopes: ['social:write'],
    input: DismissInput,
    destructiveHint: true,
  })
  dismissDraft(args: z.infer<typeof DismissInput>) {
    return this.social.dismissDraft(args.id, args.reason ?? null);
  }

  @McpTool({
    name: 'social_publish_post_draft',
    title: 'Social: Publish post draft',
    description:
      "Publish a pending draft to the platform from the calling person's own connected account, and record the resulting post id and permalink on the draft. The post goes out immediately and cannot be recalled through Munin. Fails when the caller has no connected account for that platform, when their connection has lapsed and needs reauthorizing, when the draft has already been decided, or when the platform refuses the post — in which case the draft is left marked failed with the reason. Use social_mark_draft_posted instead when the post was published by hand on the platform itself.",
    audiences: ['admin'],
    scopes: ['social:write'],
    input: IdInput,
    readOnlyHint: false,
    destructiveHint: true,
    _meta: { ui: { visibility: ['app'] } },
  })
  publishDraft(args: z.infer<typeof IdInput>) {
    return this.social.publishDraft(args.id);
  }

  @McpTool({
    name: 'social_mark_draft_posted',
    title: 'Social: Mark draft as posted',
    description:
      'Record that a draft was published by hand on the platform itself, optionally with the permalink. Use this when someone copied the text into the platform rather than publishing through Munin.',
    audiences: ['admin'],
    scopes: ['social:write'],
    input: MarkPostedInput,
    destructiveHint: true,
  })
  markPosted(args: z.infer<typeof MarkPostedInput>) {
    return this.social.markPosted(args.id, args.permalink ?? null);
  }
}
