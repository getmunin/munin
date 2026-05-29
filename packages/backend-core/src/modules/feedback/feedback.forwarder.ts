import { Inject, Injectable, Logger } from '@nestjs/common';
import { signHmac } from '@getmunin/core';
import { InstanceIdService } from './instance-id.service.ts';

const DEFAULT_INTAKE_URL = 'https://feedback.getmunin.com/v1/public/feedback';
const HMAC_KEY_CONSTANT = 'munin-feedback-intake-v1';

export interface ForwardPayload {
  title: string;
  body: string;
  appScope?: string | null;
  attribution?: { orgName?: string; userName?: string } | null;
}

export interface ForwardResult {
  ok: boolean;
  permanent: boolean;
  status: number;
  error?: string;
}

export interface PublicFeedbackItem {
  id: string;
  title: string;
  body: string;
  appScope: string | null;
  status: string;
  voteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SearchParams {
  q?: string;
  appScope?: string;
  status?: string;
  sort?: 'votes' | 'recent';
  limit?: number;
}

export interface VoteResult {
  voteCount: number;
  alreadyVoted: boolean;
}

export class FeedbackItemNotFoundError extends Error {
  readonly code = 'feedback_item_not_found';
  constructor(id: string) {
    super(`feedback_item_not_found: no public roadmap item with id ${id}`);
  }
}

export class FeedbackVoteQuotaExceededError extends Error {
  readonly code = 'feedback_vote_quota_exceeded';
  constructor() {
    super('feedback_vote_quota_exceeded: per-instance vote quota exhausted');
  }
}

export class FeedbackRemoteError extends Error {
  readonly code = 'feedback_remote_error';
  constructor(status: number, detail: string) {
    super(`feedback_remote_error: cloud responded ${status} ${detail}`);
  }
}

@Injectable()
export class FeedbackForwarder {
  private readonly logger = new Logger(FeedbackForwarder.name);

  constructor(
    @Inject(InstanceIdService) private readonly instanceId: InstanceIdService,
  ) {}

  async forward(input: ForwardPayload): Promise<ForwardResult> {
    const instanceId = await this.instanceId.get();
    const body = canonicalSubmitBody({
      title: input.title,
      body: input.body,
      appScope: input.appScope ?? null,
      attribution: input.attribution ?? null,
      instanceId,
      submittedAt: new Date().toISOString(),
    });
    const key = signHmac(instanceId, HMAC_KEY_CONSTANT);
    const signature = `v1=${signHmac(body, key)}`;

    try {
      const res = await fetch(this.intakeBaseUrl(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-munin-signature': signature,
        },
        body,
      });
      if (res.ok) return { ok: true, permanent: false, status: res.status };
      const errText = await res.text().catch(() => '');
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      return {
        ok: false,
        permanent,
        status: res.status,
        error: errText.slice(0, 300),
      };
    } catch (err) {
      this.logger.warn('feedback forward network error', err);
      return {
        ok: false,
        permanent: false,
        status: 0,
        error: err instanceof Error ? err.message : 'network_error',
      };
    }
  }

  async search(params: SearchParams): Promise<PublicFeedbackItem[]> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.appScope) qs.set('appScope', params.appScope);
    if (params.status) qs.set('status', params.status);
    if (params.sort) qs.set('sort', params.sort);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    const query = qs.toString();
    const url = query ? `${this.intakeBaseUrl()}?${query}` : this.intakeBaseUrl();

    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new FeedbackRemoteError(res.status, errText.slice(0, 300));
    }
    return (await res.json()) as PublicFeedbackItem[];
  }

  async vote(input: { feedbackId: string; comment?: string }): Promise<VoteResult> {
    const instanceId = await this.instanceId.get();
    const votedAt = new Date().toISOString();
    const body = canonicalVoteBody({
      feedbackId: input.feedbackId,
      instanceId,
      comment: input.comment ?? null,
      votedAt,
    });
    const key = signHmac(instanceId, HMAC_KEY_CONSTANT);
    const signature = `v1=${signHmac(body, key)}`;

    const url = `${this.intakeBaseUrl()}/${encodeURIComponent(input.feedbackId)}/vote`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-munin-signature': signature,
      },
      body,
    });
    if (res.ok) {
      return (await res.json()) as VoteResult;
    }
    const errText = await res.text().catch(() => '');
    if (res.status === 404) throw new FeedbackItemNotFoundError(input.feedbackId);
    if (res.status === 429) throw new FeedbackVoteQuotaExceededError();
    throw new FeedbackRemoteError(res.status, errText.slice(0, 300));
  }

  private intakeBaseUrl(): string {
    return process.env.MUNIN_FEEDBACK_INTAKE_URL ?? DEFAULT_INTAKE_URL;
  }
}

function canonicalSubmitBody(p: {
  title: string;
  body: string;
  appScope: string | null;
  attribution: { orgName?: string; userName?: string } | null;
  instanceId: string;
  submittedAt: string;
}): string {
  return JSON.stringify({
    title: p.title,
    body: p.body,
    appScope: p.appScope,
    attribution: p.attribution,
    instanceId: p.instanceId,
    submittedAt: p.submittedAt,
  });
}

export function canonicalVoteBody(p: {
  feedbackId: string;
  instanceId: string;
  comment: string | null;
  votedAt: string;
}): string {
  return JSON.stringify({
    feedbackId: p.feedbackId,
    instanceId: p.instanceId,
    comment: p.comment,
    votedAt: p.votedAt,
  });
}
