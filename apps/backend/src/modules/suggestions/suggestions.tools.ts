import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@munin/mcp-toolkit';
import { APP_SCOPES, STATUSES, SuggestionsService } from './suggestions.service.js';

const AppScopeSchema = z.enum(APP_SCOPES);
const StatusSchema = z.enum(STATUSES);

const SearchInput = z.object({
  query: z.string().min(1).max(300),
  appScope: AppScopeSchema.optional(),
  status: StatusSchema.optional(),
  limit: z.number().int().positive().max(50).optional(),
});

const ListInput = z.object({
  status: StatusSchema.optional(),
  appScope: AppScopeSchema.optional(),
  sort: z.enum(['votes', 'recent']).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const CreateInput = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(10).max(10_000),
  appScope: AppScopeSchema.optional(),
});

const VoteInput = z.object({
  id: z.string(),
  comment: z.string().max(2000).optional(),
});

const GetInput = z.object({
  id: z.string(),
});

@Injectable()
export class SuggestionsTools {
  constructor(@Inject(SuggestionsService) private readonly service: SuggestionsService) {}

  @McpTool({
    name: 'suggestion_search',
    description:
      'Search existing suggestions before creating one. Matches against title and body, ranked by votes. Filter by app (kb / conv / crm / core) or status.',
    audiences: ['admin'],
    scopes: [],
    input: SearchInput,
  })
  search(args: z.infer<typeof SearchInput>) {
    return this.service.search(args);
  }

  @McpTool({
    name: 'suggestion_list',
    description:
      'List suggestions for your org, default sort by votes desc. Pass `sort: "recent"` for newest first.',
    audiences: ['admin'],
    scopes: [],
    input: ListInput,
  })
  list(args: z.infer<typeof ListInput>) {
    return this.service.list(args);
  }

  @McpTool({
    name: 'suggestion_get',
    description: 'Read one suggestion by id.',
    audiences: ['admin'],
    scopes: [],
    input: GetInput,
  })
  get(args: z.infer<typeof GetInput>) {
    return this.service.get(args.id);
  }

  @McpTool({
    name: 'suggestion_create',
    description:
      'Create a new product-feedback suggestion. Search first to avoid duplicates. Tag the relevant app via `appScope` (kb / conv / crm / core).',
    audiences: ['admin'],
    scopes: [],
    input: CreateInput,
  })
  create(args: z.infer<typeof CreateInput>) {
    return this.service.create(args);
  }

  @McpTool({
    name: 'suggestion_vote',
    description:
      'Vote for an existing suggestion. Optional `comment` records *why* this matters, which is the high-signal field. Voting is idempotent — repeat calls do not stack.',
    audiences: ['admin'],
    scopes: [],
    input: VoteInput,
  })
  vote(args: z.infer<typeof VoteInput>) {
    return this.service.vote(args);
  }
}
