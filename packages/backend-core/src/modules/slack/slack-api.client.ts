import { Injectable } from '@nestjs/common';

const SLACK_API_BASE = 'https://slack.com/api';
const REQUEST_TIMEOUT_MS = 15_000;

export class SlackApiError extends Error {
  constructor(
    readonly apiError: string,
    readonly retryAfterMs?: number,
  ) {
    super(`slack_api_error: ${apiError}`);
    this.name = 'SlackApiError';
  }
}

interface SlackEnvelope {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface SlackInstallResult {
  botToken: string;
  botUserId: string | null;
  appId: string | null;
  teamId: string;
  teamName: string | null;
}

export interface SlackChannelInfo {
  id: string;
  name: string | null;
  isMember: boolean;
}

export interface SlackUserInfo {
  id: string;
  email: string | null;
  displayName: string | null;
  isBot: boolean;
}

@Injectable()
export class SlackApiClient {
  async postMessage(input: {
    token: string;
    channel: string;
    text: string;
    blocks?: unknown[];
    threadTs?: string;
  }): Promise<{ ts: string; channel: string }> {
    const data = await this.call('chat.postMessage', input.token, {
      channel: input.channel,
      text: input.text,
      unfurl_links: false,
      unfurl_media: false,
      ...(input.blocks ? { blocks: input.blocks } : {}),
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    });
    return { ts: data.ts as string, channel: data.channel as string };
  }

  async updateMessage(input: {
    token: string;
    channel: string;
    ts: string;
    text: string;
    blocks?: unknown[];
  }): Promise<void> {
    await this.call('chat.update', input.token, {
      channel: input.channel,
      ts: input.ts,
      text: input.text,
      ...(input.blocks ? { blocks: input.blocks } : {}),
    });
  }

  async postEphemeral(input: {
    token: string;
    channel: string;
    user: string;
    text: string;
    threadTs?: string;
  }): Promise<void> {
    await this.call('chat.postEphemeral', input.token, {
      channel: input.channel,
      user: input.user,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    });
  }

  async usersInfo(input: { token: string; user: string }): Promise<SlackUserInfo> {
    const data = await this.call('users.info', input.token, { user: input.user });
    const user = data.user as Record<string, unknown> | undefined;
    const profile = user?.profile as Record<string, unknown> | undefined;
    const displayName =
      (typeof profile?.display_name === 'string' && profile.display_name) ||
      (typeof user?.real_name === 'string' && user.real_name) ||
      (typeof user?.name === 'string' && user.name) ||
      null;
    return {
      id: (user?.id as string) ?? input.user,
      email: typeof profile?.email === 'string' ? profile.email : null,
      displayName,
      isBot: user?.is_bot === true,
    };
  }

  async conversationsInfo(input: { token: string; channel: string }): Promise<SlackChannelInfo> {
    const data = await this.call('conversations.info', input.token, { channel: input.channel });
    const channel = data.channel as Record<string, unknown> | undefined;
    return {
      id: (channel?.id as string) ?? input.channel,
      name: typeof channel?.name === 'string' ? channel.name : null,
      isMember: channel?.is_member === true,
    };
  }

  async oauthAccess(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<SlackInstallResult> {
    const res = await fetch(`${SLACK_API_BASE}/oauth.v2.access`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = (await res.json()) as SlackEnvelope & {
      access_token?: string;
      bot_user_id?: string;
      app_id?: string;
      team?: { id?: string; name?: string };
    };
    if (!data.ok || !data.access_token || !data.team?.id) {
      throw new SlackApiError(data.error ?? 'oauth_exchange_failed');
    }
    return {
      botToken: data.access_token,
      botUserId: data.bot_user_id ?? null,
      appId: data.app_id ?? null,
      teamId: data.team.id,
      teamName: data.team.name ?? null,
    };
  }

  private async call(
    method: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '30');
      throw new SlackApiError('rate_limited', Math.max(1, retryAfter) * 1000);
    }
    const data = (await res.json()) as SlackEnvelope;
    if (!data.ok) throw new SlackApiError(data.error ?? 'unknown_error');
    return data;
  }
}
