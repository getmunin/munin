import { Injectable } from '@nestjs/common';
import {
  BOT_FRAMEWORK_SCOPE,
  isAllowedServiceUrl,
  normalizeServiceUrl,
  parseThreadConversationId,
} from './teams.constants.ts';
import { ConversationRateLimiter } from './teams-rate-limiter.ts';

const REQUEST_TIMEOUT_MS = 15_000;
const MULTI_TENANT_AUTHORITY = 'botframework.com';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_INLINE_WAIT_MS = 2_000;
const TERMINAL_CODES = new Set([
  'MessageWritesBlocked',
  'BotNotInConversationRoster',
  'ConversationBlockedByUser',
  'BotDisabledByAdmin',
  'invalid_client',
  'unauthorized_client',
]);

export class TeamsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterMs?: number,
    readonly tokenDetail?: string,
  ) {
    super(`teams_api_error: ${status} ${code}`);
    this.name = 'TeamsApiError';
  }

  get fromTokenEndpoint(): boolean {
    return this.tokenDetail !== undefined;
  }

  get terminal(): boolean {
    return TERMINAL_CODES.has(this.code) || this.status === 401 || this.status === 404;
  }
}

export class TeamsThrottledError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`teams_throttled: retry in ${retryAfterMs}ms`);
    this.name = 'TeamsThrottledError';
  }
}

export interface TeamsBotCredentials {
  appId: string;
  tenantId: string;
  appSecret: string;
}

export interface TeamsActivity {
  type: 'message';
  text?: string;
  textFormat?: 'markdown' | 'plain' | 'xml';
  attachments?: Array<{ contentType: string; content: unknown }>;
  entities?: unknown[];
  summary?: string;
}

export interface TeamsMember {
  id: string;
  aadObjectId: string | null;
  name: string | null;
  email: string | null;
  userPrincipalName: string | null;
}

export interface TeamsChannel {
  id: string;
  name: string;
}

@Injectable()
export class TeamsApiClient {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly multiTenantApps = new Set<string>();
  private readonly limiter = new ConversationRateLimiter();

  forgetToken(appId: string): void {
    for (const key of this.tokens.keys()) {
      if (key.startsWith(`${appId}:`)) this.tokens.delete(key);
    }
    this.multiTenantApps.delete(appId);
  }

  async acquireToken(creds: TeamsBotCredentials): Promise<string> {
    return await this.tokenFrom(creds, creds.tenantId);
  }

  private authorityFor(creds: TeamsBotCredentials): string {
    return this.multiTenantApps.has(creds.appId) ? MULTI_TENANT_AUTHORITY : creds.tenantId;
  }

  private async tokenFrom(creds: TeamsBotCredentials, authority: string): Promise<string> {
    const key = `${creds.appId}:${authority}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cached.token;
    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: creds.appId,
          client_secret: creds.appSecret,
          scope: BOT_FRAMEWORK_SCOPE,
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      const firstLine = (data.error_description ?? '').split(/\r?\n/)[0]!.trim();
      const detail = (/^.*?\.(?=\s|$)/.exec(firstLine)?.[0] ?? firstLine).slice(0, 240);
      throw new TeamsApiError(
        res.status === 200 ? 401 : res.status,
        data.error ?? 'token_request_failed',
        undefined,
        detail,
      );
    }
    const ttlMs = (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000;
    this.tokens.set(key, { token: data.access_token, expiresAt: Date.now() + ttlMs });
    return data.access_token;
  }

  async createChannelThread(input: {
    creds: TeamsBotCredentials;
    serviceUrl: string;
    channelId: string;
    tenantId: string;
    activity: TeamsActivity;
  }): Promise<{ conversationId: string; activityId: string }> {
    const data = await this.request({
      creds: input.creds,
      method: 'POST',
      url: `${this.base(input.serviceUrl)}v3/conversations`,
      rateKey: this.rateKey(input.serviceUrl, input.channelId),
      body: {
        isGroup: true,
        channelData: { channel: { id: input.channelId }, tenant: { id: input.tenantId } },
        activity: input.activity,
        tenantId: input.tenantId,
      },
    });
    const activityId = typeof data.activityId === 'string' ? data.activityId : null;
    const conversationId = typeof data.id === 'string' ? data.id : null;
    if (!activityId || !conversationId) throw new TeamsApiError(502, 'missing_activity_id');
    return { conversationId, activityId };
  }

  async sendToConversation(input: {
    creds: TeamsBotCredentials;
    serviceUrl: string;
    conversationId: string;
    activity: TeamsActivity;
  }): Promise<{ activityId: string }> {
    const data = await this.request({
      creds: input.creds,
      method: 'POST',
      url: `${this.base(input.serviceUrl)}v3/conversations/${encodeURIComponent(input.conversationId)}/activities`,
      rateKey: this.rateKey(input.serviceUrl, input.conversationId),
      body: input.activity,
    });
    const activityId = typeof data.id === 'string' ? data.id : null;
    if (!activityId) throw new TeamsApiError(502, 'missing_activity_id');
    return { activityId };
  }

  async updateActivity(input: {
    creds: TeamsBotCredentials;
    serviceUrl: string;
    conversationId: string;
    activityId: string;
    activity: TeamsActivity;
  }): Promise<void> {
    await this.request({
      creds: input.creds,
      method: 'PUT',
      url: `${this.base(input.serviceUrl)}v3/conversations/${encodeURIComponent(input.conversationId)}/activities/${encodeURIComponent(input.activityId)}`,
      rateKey: this.rateKey(input.serviceUrl, input.conversationId),
      body: { ...input.activity, id: input.activityId },
    });
  }

  async getMember(input: {
    creds: TeamsBotCredentials;
    serviceUrl: string;
    conversationId: string;
    memberId: string;
  }): Promise<TeamsMember> {
    const { channelId } = parseThreadConversationId(input.conversationId);
    const data = await this.request({
      creds: input.creds,
      method: 'GET',
      url: `${this.base(input.serviceUrl)}v3/conversations/${encodeURIComponent(channelId)}/members/${encodeURIComponent(input.memberId)}`,
    });
    const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
    return {
      id: str(data.id) ?? input.memberId,
      aadObjectId: str(data.aadObjectId),
      name: str(data.name),
      email: str(data.email),
      userPrincipalName: str(data.userPrincipalName),
    };
  }

  async listTeamChannels(input: {
    creds: TeamsBotCredentials;
    serviceUrl: string;
    teamId: string;
  }): Promise<TeamsChannel[]> {
    const data = await this.request({
      creds: input.creds,
      method: 'GET',
      url: `${this.base(input.serviceUrl)}v3/teams/${encodeURIComponent(input.teamId)}/conversations`,
    });
    const raw = Array.isArray(data.conversations)
      ? (data.conversations as Array<Record<string, unknown>>)
      : [];
    return raw
      .filter((c) => typeof c.id === 'string')
      .map((c) => ({
        id: c.id as string,
        name: typeof c.name === 'string' && c.name.length > 0 ? c.name : 'General',
      }));
  }

  private base(serviceUrl: string): string {
    if (!isAllowedServiceUrl(serviceUrl)) throw new TeamsApiError(400, 'service_url_not_allowed');
    return normalizeServiceUrl(serviceUrl);
  }

  private rateKey(serviceUrl: string, conversationId: string): string {
    return `${normalizeServiceUrl(serviceUrl)}|${parseThreadConversationId(conversationId).channelId}`;
  }

  private async throttle(rateKey: string): Promise<void> {
    for (;;) {
      const wait = this.limiter.waitMs(rateKey);
      if (wait === 0) {
        this.limiter.record(rateKey);
        return;
      }
      if (wait > MAX_INLINE_WAIT_MS) throw new TeamsThrottledError(wait);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  private async request(input: {
    creds: TeamsBotCredentials;
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    rateKey?: string;
    body?: unknown;
  }): Promise<Record<string, unknown>> {
    if (input.rateKey) await this.throttle(input.rateKey);
    try {
      return await this.send(input, this.authorityFor(input.creds));
    } catch (err) {
      const retryAsMultiTenant =
        err instanceof TeamsApiError &&
        err.status === 401 &&
        !err.fromTokenEndpoint &&
        !this.multiTenantApps.has(input.creds.appId);
      if (!retryAsMultiTenant) throw err;
      this.multiTenantApps.add(input.creds.appId);
      try {
        return await this.send(input, MULTI_TENANT_AUTHORITY);
      } catch (retryErr) {
        this.multiTenantApps.delete(input.creds.appId);
        throw retryErr;
      }
    }
  }

  private async send(
    input: { creds: TeamsBotCredentials; method: 'GET' | 'POST' | 'PUT'; url: string; body?: unknown },
    authority: string,
  ): Promise<Record<string, unknown>> {
    const token = await this.tokenFrom(input.creds, authority);
    const res = await fetch(input.url, {
      method: input.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed === 'object' && parsed !== null) data = parsed as Record<string, unknown>;
      } catch {
        data = {};
      }
    }
    if (res.ok) return data;
    if (res.status === 401) this.tokens.delete(`${input.creds.appId}:${authority}`);
    const error = data.error as Record<string, unknown> | undefined;
    const code = typeof error?.code === 'string' ? error.code : `http_${res.status}`;
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new TeamsApiError(
      res.status,
      code,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
  }
}
