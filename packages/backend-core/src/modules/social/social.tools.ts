import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { SOCIAL_DRAFT_STATUSES, SOCIAL_PLATFORMS } from './social-platform.ts';
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

const DismissInput = z.object({
  id: z.string(),
  reason: z.string().max(500).nullable().optional(),
});

const CreateDraftInput = z.object({
  body: z.string().min(1),
  platform: PlatformField,
  linkUrl: z.string().url().nullable().optional(),
  variantLabel: z.string().min(1).max(32).optional(),
});

const ProposeSetInput = z.object({
  variants: z
    .array(z.object({ variantLabel: z.string().min(1).max(32), body: z.string().min(1) }))
    .min(1)
    .max(8),
  platform: PlatformField,
  linkUrl: z.string().url().nullable().optional(),
  sourceRef: z.record(z.string(), z.unknown()).optional(),
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
      'Store a single social post draft for a person to review and publish. Use this to hand over any piece of text meant for social, whether or not it relates to a published article.',
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
    name: 'social_revise_post_draft',
    title: 'Social: Revise post draft',
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
