import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { APP_SCOPES, FeedbackService } from './feedback.service.ts';

const AppScopeSchema = z.enum(APP_SCOPES);

const CreateInput = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(10).max(4000),
  appScope: AppScopeSchema.optional(),
  includeOrgName: z.boolean().optional(),
  includeUserName: z.boolean().optional(),
});

const IdInput = z.object({ id: z.string() });

const EmptyInput = z.object({});

const StatusSchema = z.enum(['open', 'planned', 'in_progress', 'done', 'wontfix', 'duplicate']);
const SortSchema = z.enum(['votes', 'recent']);

const SearchInput = z.object({
  q: z.string().min(1).max(200).optional(),
  appScope: AppScopeSchema.optional(),
  status: StatusSchema.optional(),
  sort: SortSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const VoteInput = z.object({
  id: z.string(),
  comment: z.string().max(2000).optional(),
});

@Injectable()
export class FeedbackTools {
  constructor(@Inject(FeedbackService) private readonly service: FeedbackService) {}

  @McpTool({
    name: 'feedback_create',
    title: 'Feedback: Create',
    description:
      'Submit feedback about Munin. Stays local until an org admin approves it; dismissal deletes the item. Set includeOrgName / includeUserName to attach attribution; both default false.',
    audiences: ['admin'],
    scopes: ['feedback:write'],
    input: CreateInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  create(args: z.infer<typeof CreateInput>) {
    return this.service.create(args);
  }

  @McpTool({
    name: 'feedback_list',
    title: 'Feedback: List pending',
    description: 'List feedback items in the local outbox awaiting admin action.',
    audiences: ['admin'],
    scopes: ['feedback:read'],
    input: EmptyInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async list() {
    return { items: await this.service.listPending() };
  }

  @McpTool({
    name: 'feedback_get',
    title: 'Feedback: Get one',
    description: 'Read a single feedback item by id.',
    audiences: ['admin'],
    scopes: ['feedback:read'],
    input: IdInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  get(args: z.infer<typeof IdInput>) {
    return this.service.get(args.id);
  }

  @McpTool({
    name: 'feedback_approve',
    title: 'Feedback: Approve and forward',
    description:
      'Approve a feedback item: transmits the contents to Munin developers and deletes the local row on success. Attribution is included only when the submitter opted in.',
    audiences: ['admin'],
    scopes: ['feedback:write'],
    input: IdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async approve(args: z.infer<typeof IdInput>) {
    await this.service.approve(args.id);
    return { ok: true };
  }

  @McpTool({
    name: 'feedback_dismiss',
    title: 'Feedback: Dismiss',
    description: 'Dismiss (delete) a pending feedback item. Nothing is sent to Munin.',
    audiences: ['admin'],
    scopes: ['feedback:write'],
    input: IdInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async dismiss(args: z.infer<typeof IdInput>) {
    await this.service.dismiss(args.id);
    return { ok: true };
  }

  @McpTool({
    name: 'feedback_search',
    title: 'Feedback: Search global roadmap',
    description:
      'Search the public Munin roadmap for items matching a query. Call this before feedback_create to find an existing item to vote on instead of filing a duplicate. Returns only items the Munin team has published; pending and rejected items are hidden. sort defaults to votes (highest first); use "recent" for newest. limit is capped at 100.',
    audiences: ['admin'],
    scopes: ['feedback:read'],
    input: SearchInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async search(args: z.infer<typeof SearchInput>) {
    return { items: await this.service.search(args) };
  }

  @McpTool({
    name: 'feedback_vote',
    title: 'Feedback: Vote on roadmap item',
    description:
      'Cast this instance\'s vote on a published roadmap item, optionally attaching a short comment. Idempotent: a second call from the same instance returns { alreadyVoted: true } without inflating the count. Throws feedback_item_not_found if the id is unknown or the item is not public, and feedback_vote_quota_exceeded if the per-instance quota has been hit.',
    audiences: ['admin'],
    scopes: ['feedback:write'],
    input: VoteInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async vote(args: z.infer<typeof VoteInput>) {
    return this.service.vote({ feedbackId: args.id, comment: args.comment });
  }
}
