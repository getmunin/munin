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

@Injectable()
export class FeedbackTools {
  constructor(@Inject(FeedbackService) private readonly service: FeedbackService) {}

  @McpTool({
    name: 'feedback_create',
    title: 'Feedback: Create',
    description:
      'Submit feedback about Munin. Stays local until an org admin approves it; rejection deletes the item. Set includeOrgName / includeUserName to attach attribution; both default false.',
    audiences: ['admin'],
    scopes: [],
    input: CreateInput,
  })
  create(args: z.infer<typeof CreateInput>) {
    return this.service.create(args);
  }

  @McpTool({
    name: 'feedback_list',
    title: 'Feedback: List pending',
    description: 'List feedback items in the local outbox awaiting admin action.',
    audiences: ['admin'],
    scopes: [],
    input: EmptyInput,
    readOnlyHint: true,
  })
  async list() {
    return { items: await this.service.listPending() };
  }

  @McpTool({
    name: 'feedback_get',
    title: 'Feedback: Get one',
    description: 'Read a single feedback item by id.',
    audiences: ['admin'],
    scopes: [],
    input: IdInput,
    readOnlyHint: true,
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
    scopes: [],
    input: IdInput,
  })
  async approve(args: z.infer<typeof IdInput>) {
    await this.service.approve(args.id);
    return { ok: true };
  }

  @McpTool({
    name: 'feedback_reject',
    title: 'Feedback: Reject',
    description: 'Reject (delete) a pending feedback item. Nothing is sent to Munin.',
    audiences: ['admin'],
    scopes: [],
    input: IdInput,
    destructiveHint: true,
  })
  async reject(args: z.infer<typeof IdInput>) {
    await this.service.reject(args.id);
    return { ok: true };
  }
}
