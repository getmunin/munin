import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext } from '@getmunin/core';
import {
  FeedbackForwarder,
  type PublicFeedbackItem,
  type SearchParams,
  type VoteResult,
} from './feedback.forwarder.ts';

const APP_SCOPES = ['kb', 'conv', 'crm', 'cms', 'core'] as const;
export type FeedbackAppScope = (typeof APP_SCOPES)[number];

export class FeedbackNotFoundError extends Error {
  readonly code = 'feedback_not_found';
  constructor(id: string) {
    super(`feedback_not_found: no item with id ${id}`);
  }
}

export class FeedbackForwardFailedError extends Error {
  readonly code = 'feedback_forward_failed';
  constructor(status: number, detail: string) {
    super(`feedback_forward_failed: intake responded ${status} ${detail}`);
  }
}

export interface FeedbackOutboxDto {
  id: string;
  title: string;
  body: string;
  appScope: FeedbackAppScope | null;
  includeOrgName: boolean;
  includeUserName: boolean;
  submittedByUserId: string | null;
  createdAt: string;
  approvedAt: string | null;
  forwardError: string | null;
}

@Injectable()
export class FeedbackService {
  constructor(@Inject(FeedbackForwarder) private readonly forwarder: FeedbackForwarder) {}

  async create(input: {
    title: string;
    body: string;
    appScope?: FeedbackAppScope;
    includeOrgName?: boolean;
    includeUserName?: boolean;
  }): Promise<FeedbackOutboxDto> {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    const [row] = await ctx.db
      .insert(schema.feedbackOutbox)
      .values({
        orgId: actor.orgId,
        submittedByUserId: actor.userId ?? null,
        title: input.title,
        body: input.body,
        appScope: input.appScope ?? null,
        includeOrgName: input.includeOrgName ?? false,
        includeUserName: input.includeUserName ?? false,
      })
      .returning();
    return toDto(row!);
  }

  async listPending(): Promise<FeedbackOutboxDto[]> {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.feedbackOutbox)
      .orderBy(desc(schema.feedbackOutbox.createdAt));
    return rows.map(toDto);
  }

  async get(id: string): Promise<FeedbackOutboxDto> {
    const row = await this.findById(id);
    if (!row) throw new FeedbackNotFoundError(id);
    return toDto(row);
  }

  async dismiss(id: string): Promise<void> {
    const ctx = getCurrentContext();
    const result = await ctx.db
      .delete(schema.feedbackOutbox)
      .where(eq(schema.feedbackOutbox.id, id))
      .returning({ id: schema.feedbackOutbox.id });
    if (result.length === 0) throw new FeedbackNotFoundError(id);
  }

  async approve(id: string): Promise<void> {
    const ctx = getCurrentContext();
    const row = await this.findById(id);
    if (!row) throw new FeedbackNotFoundError(id);

    const attribution = await this.buildAttribution(row);
    const result = await this.forwarder.forward({
      title: row.title,
      body: row.body,
      appScope: row.appScope,
      attribution,
    });

    if (result.ok) {
      await ctx.db
        .delete(schema.feedbackOutbox)
        .where(eq(schema.feedbackOutbox.id, id));
      return;
    }

    const errorText = `${result.status}: ${result.error ?? 'unknown'}`;
    if (result.permanent) {
      await ctx.db
        .update(schema.feedbackOutbox)
        .set({
          approvedAt: new Date(),
          forwardError: errorText,
          updatedAt: new Date(),
        })
        .where(eq(schema.feedbackOutbox.id, id));
    } else {
      await ctx.db
        .update(schema.feedbackOutbox)
        .set({ forwardError: errorText, updatedAt: new Date() })
        .where(eq(schema.feedbackOutbox.id, id));
    }
    throw new FeedbackForwardFailedError(result.status, errorText);
  }

  search(params: SearchParams): Promise<PublicFeedbackItem[]> {
    return this.forwarder.search(params);
  }

  vote(input: { feedbackId: string; comment?: string }): Promise<VoteResult> {
    return this.forwarder.vote(input);
  }

  private async findById(id: string) {
    const ctx = getCurrentContext();
    const rows = await ctx.db
      .select()
      .from(schema.feedbackOutbox)
      .where(eq(schema.feedbackOutbox.id, id))
      .limit(1);
    return rows[0];
  }

  private async buildAttribution(
    row: typeof schema.feedbackOutbox.$inferSelect,
  ): Promise<{ orgName?: string; userName?: string } | null> {
    if (!row.includeOrgName && !row.includeUserName) return null;
    const ctx = getCurrentContext();
    const out: { orgName?: string; userName?: string } = {};
    if (row.includeOrgName) {
      const orgs = await ctx.db
        .select({ name: schema.orgs.name })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, row.orgId))
        .limit(1);
      const name = orgs[0]?.name?.trim();
      if (name) out.orgName = name;
    }
    if (row.includeUserName && row.submittedByUserId) {
      const users = await ctx.db
        .select({ name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, row.submittedByUserId))
        .limit(1);
      const u = users[0];
      const display = u?.name?.trim() || u?.email?.trim();
      if (display) out.userName = display;
    }
    if (!out.orgName && !out.userName) return null;
    return out;
  }
}

function toDto(row: typeof schema.feedbackOutbox.$inferSelect): FeedbackOutboxDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    appScope: (row.appScope as FeedbackAppScope | null) ?? null,
    includeOrgName: row.includeOrgName,
    includeUserName: row.includeUserName,
    submittedByUserId: row.submittedByUserId,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    forwardError: row.forwardError,
  };
}

export { APP_SCOPES };
