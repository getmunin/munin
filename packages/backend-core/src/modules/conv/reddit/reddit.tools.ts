import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import {
  RedditApiError,
  RedditClientService,
  stripFullnamePrefix,
  stripSubredditPrefix,
  type RedditCredentials,
} from './reddit-client.service.ts';
import { RedditService, jsonbToStored } from './reddit.service.ts';

const MAX_SEARCH_RESULTS = 25;
const MAX_THREAD_COMMENTS = 50;
const TITLE_CHARS = 300;
const SEARCH_EXCERPT_CHARS = 500;
const POST_BODY_CHARS = 2_000;
const COMMENT_BODY_CHARS = 700;
const RULE_DESCRIPTION_CHARS = 600;
const MAX_RULES = 50;

const SubredditSchema = z
  .string()
  .min(2)
  .max(40)
  .describe('Subreddit name, with or without the "r/" prefix.');

const SearchThreadsInput = z.object({
  channelId: z
    .string()
    .describe('Reddit channel whose stored script-app credentials are used for the request.'),
  query: z.string().min(1).max(512).describe('Reddit search query.'),
  subreddit: SubredditSchema.optional().describe(
    'Restrict the search to one subreddit. Omit to search all of Reddit.',
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_RESULTS)
    .optional()
    .describe(`Maximum posts to return (default 10, hard cap ${MAX_SEARCH_RESULTS}).`),
  sort: z
    .enum(['relevance', 'hot', 'top', 'new', 'comments'])
    .optional()
    .describe('Result ordering (default relevance).'),
  time: z
    .enum(['hour', 'day', 'week', 'month', 'year', 'all'])
    .optional()
    .describe('Age window for results (default month).'),
});

const GetThreadInput = z.object({
  channelId: z
    .string()
    .describe('Reddit channel whose stored script-app credentials are used for the request.'),
  threadId: z
    .string()
    .min(1)
    .max(32)
    .describe('Post id, with or without the "t3_" prefix.'),
  commentLimit: z
    .number()
    .int()
    .min(1)
    .max(MAX_THREAD_COMMENTS)
    .optional()
    .describe(`Maximum comments to return (default 20, hard cap ${MAX_THREAD_COMMENTS}).`),
  maxDepth: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe('How deep into the reply tree to descend (default 2).'),
});

const GetRulesInput = z.object({
  channelId: z
    .string()
    .describe('Reddit channel whose stored script-app credentials are used for the request.'),
  subreddit: SubredditSchema,
});

const ConnectUrlInput = z.object({
  channelId: z.string().min(1).max(64).describe('Id of the Reddit channel to authorize.'),
});

@Injectable()
export class RedditAdminTools {
  constructor(
    @Inject(RedditService) private readonly reddit: RedditService,
    @Inject(RedditClientService) private readonly client: RedditClientService,
  ) {}

  @McpTool({
    name: 'conv_search_reddit_threads',
    title: 'Conv: Search Reddit threads',
    description:
      'Search Reddit posts by keyword, optionally restricted to one subreddit, using a Reddit channel\'s stored credentials. Returns post id, title, author, subreddit, score, comment count, permalink and a truncated excerpt of the body. Use it to find public threads that are worth answering. Titles and excerpts are capped, so the payload stays small enough to hand to a model.',
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: SearchThreadsInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async searchThreads(args: z.infer<typeof SearchThreadsInput>) {
    const credentials = await this.credentialsFor(args.channelId);
    const limit = args.limit ?? 10;
    const res = await this.callReddit(() =>
      this.client.searchThreads(credentials, {
        query: args.query,
        limit,
        ...(args.subreddit ? { subreddit: stripSubredditPrefix(args.subreddit) } : {}),
        ...(args.sort ? { sort: args.sort } : {}),
        ...(args.time ? { time: args.time } : {}),
      }),
    );
    let bodiesTruncated = 0;
    const threads = res.data.map((post) => {
      const excerpt = cap(post.selftext, SEARCH_EXCERPT_CHARS);
      if (excerpt.truncated) bodiesTruncated += 1;
      return {
        threadId: post.id,
        fullname: post.fullname,
        title: cap(post.title, TITLE_CHARS).text,
        author: post.author,
        subreddit: post.subreddit,
        permalink: post.permalink,
        url: post.url,
        score: post.score,
        upvoteRatio: post.upvoteRatio,
        numComments: post.numComments,
        createdAt: toIso(post.createdUtc),
        excerpt: excerpt.text,
        flair: post.flair,
        over18: post.over18,
        locked: post.locked,
        archived: post.archived,
      };
    });
    return {
      query: args.query,
      subreddit: args.subreddit ? stripSubredditPrefix(args.subreddit) : null,
      threads,
      truncated: {
        resultsCapAt: limit,
        excerptCharLimit: SEARCH_EXCERPT_CHARS,
        bodiesTruncated,
      },
      rateLimit: res.rateLimit,
    };
  }

  @McpTool({
    name: 'conv_get_reddit_thread',
    title: 'Conv: Read a Reddit thread and its comments',
    description:
      "Read one Reddit post plus a bounded slice of its comment tree, using a Reddit channel's stored credentials. Comments are flattened with a depth field, capped in count and depth, and each body is truncated; the response reports what was cut and whether more comments exist. Use it to read the full context of a thread before deciding whether and how to reply.",
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: GetThreadInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async getThread(args: z.infer<typeof GetThreadInput>) {
    const credentials = await this.credentialsFor(args.channelId);
    const commentLimit = args.commentLimit ?? 20;
    const maxDepth = args.maxDepth ?? 2;
    const res = await this.callReddit(() =>
      this.client.getThread(credentials, {
        threadId: stripFullnamePrefix(args.threadId),
        commentLimit,
        maxDepth,
      }),
    );
    const post = res.data.post;
    const postBody = post ? cap(post.selftext, POST_BODY_CHARS) : { text: '', truncated: false };
    let commentBodiesTruncated = 0;
    const comments = res.data.comments.map((comment) => {
      const body = cap(comment.body, COMMENT_BODY_CHARS);
      if (body.truncated) commentBodiesTruncated += 1;
      return {
        commentId: comment.id,
        fullname: comment.fullname,
        author: comment.author,
        body: body.text,
        score: comment.score,
        depth: comment.depth,
        parentFullname: comment.parentFullname,
        createdAt: toIso(comment.createdUtc),
      };
    });
    return {
      post: post
        ? {
            threadId: post.id,
            fullname: post.fullname,
            title: cap(post.title, TITLE_CHARS).text,
            author: post.author,
            subreddit: post.subreddit,
            permalink: post.permalink,
            url: post.url,
            score: post.score,
            upvoteRatio: post.upvoteRatio,
            numComments: post.numComments,
            createdAt: toIso(post.createdUtc),
            body: postBody.text,
            flair: post.flair,
            over18: post.over18,
            locked: post.locked,
            archived: post.archived,
          }
        : null,
      comments,
      truncated: {
        commentsCapAt: commentLimit,
        maxDepth,
        moreCommentsAvailable: res.data.moreCommentsAvailable,
        postBodyTruncated: postBody.truncated,
        commentBodyCharLimit: COMMENT_BODY_CHARS,
        commentBodiesTruncated,
      },
      rateLimit: res.rateLimit,
    };
  }

  @McpTool({
    name: 'conv_get_reddit_connect_url',
    title: 'Conv: Get a Reddit authorization link',
    description:
      "Return the Reddit authorization link for a Reddit channel, plus the redirect uri the channel's Reddit app must be registered with. A person opens the link, approves the permissions as the account the channel is configured for, and Reddit sends them back to Munin, which stores the grant and activates the channel. The link expires after ten minutes. The channel must already have its client secret stored.",
    audiences: ['admin'],
    scopes: ['conv:write'],
    input: ConnectUrlInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  async getRedditConnectUrl(args: z.infer<typeof ConnectUrlInput>) {
    const channel = await this.reddit.requireChannel(args.channelId);
    return this.reddit.connectUrl(channel.id, jsonbToStored(channel.config));
  }

  @McpTool({
    name: 'conv_get_subreddit_rules',
    title: "Conv: Read a subreddit's rules",
    description:
      "Read a subreddit's posted rules and the site-wide rules, using a Reddit channel's stored credentials. Returns each rule's short name, what it applies to, its violation reason and a truncated description. Use it to check what a subreddit permits before posting there.",
    audiences: ['admin'],
    scopes: ['conv:read'],
    input: GetRulesInput,
    readOnlyHint: true,
    destructiveHint: false,
  })
  async getSubredditRules(args: z.infer<typeof GetRulesInput>) {
    const credentials = await this.credentialsFor(args.channelId);
    const subreddit = stripSubredditPrefix(args.subreddit);
    if (!subreddit) {
      throw new BadRequestException('conv_invalid: subreddit must not be empty');
    }
    const res = await this.callReddit(() =>
      this.client.getSubredditRules(credentials, subreddit),
    );
    let descriptionsTruncated = 0;
    const rules = res.data.rules.slice(0, MAX_RULES).map((rule) => {
      const description = cap(rule.description, RULE_DESCRIPTION_CHARS);
      if (description.truncated) descriptionsTruncated += 1;
      return {
        shortName: rule.shortName,
        appliesTo: rule.appliesTo,
        violationReason: rule.violationReason,
        description: description.text,
      };
    });
    return {
      subreddit,
      rules,
      siteRules: res.data.siteRules.slice(0, MAX_RULES),
      truncated: {
        rulesCapAt: MAX_RULES,
        rulesOmitted: Math.max(res.data.rules.length - MAX_RULES, 0),
        descriptionCharLimit: RULE_DESCRIPTION_CHARS,
        descriptionsTruncated,
      },
      rateLimit: res.rateLimit,
    };
  }

  private async credentialsFor(channelId: string): Promise<RedditCredentials> {
    const channel = await this.reddit.requireChannel(channelId);
    return this.reddit.loadCredentials(channel.id, jsonbToStored(channel.config));
  }

  private async callReddit<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RedditApiError) throw new BadRequestException(`conv_invalid: ${err.message}`);
      throw new BadRequestException(
        `conv_invalid: reddit request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function cap(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: `${value.slice(0, max)}…`, truncated: true };
}

function toIso(createdUtc: number | null): string | null {
  if (createdUtc === null) return null;
  const date = new Date(createdUtc * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
