import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamsApiClient, TeamsApiError } from './teams-api.client.ts';

const creds = {
  appId: '11111111-2222-3333-4444-555555555555',
  tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  appSecret: 'secret',
};
const SERVICE_URL = 'https://smba.trafficmanager.net/emea/';

interface Call {
  url: string;
  authorization: string | null;
}

function stubFetch(handler: (url: string, call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call = { url: input, authorization: headers.get('authorization') };
    calls.push(call);
    return Promise.resolve(handler(input, call));
  });
  return calls;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function tokenFor(url: string): Response {
  const authority = /login\.microsoftonline\.com\/([^/]+)\//.exec(url)?.[1] ?? 'unknown';
  return json({ access_token: `token-${authority}`, expires_in: 3600 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TeamsApiClient', () => {
  it('posts a new channel thread with the tenant-scoped token and returns the root activity id', async () => {
    const calls = stubFetch((url) => {
      if (url.includes('login.microsoftonline.com')) return tokenFor(url);
      return json({ id: '19:c@thread.tacv2;messageid=1700', activityId: '1700' });
    });
    const posted = await new TeamsApiClient().createChannelThread({
      creds,
      serviceUrl: SERVICE_URL,
      channelId: '19:c@thread.tacv2',
      tenantId: creds.tenantId,
      activity: { type: 'message', text: 'hi' },
    });
    expect(posted).toEqual({ conversationId: '19:c@thread.tacv2;messageid=1700', activityId: '1700' });
    expect(calls[0]!.url).toContain(`/${creds.tenantId}/oauth2/v2.0/token`);
    expect(calls[1]).toEqual({
      url: `${SERVICE_URL}v3/conversations`,
      authorization: `Bearer token-${creds.tenantId}`,
    });
  });

  it('falls back to the multi-tenant token authority when the Bot Connector rejects the tenant token', async () => {
    const calls = stubFetch((url, call) => {
      if (url.includes('login.microsoftonline.com')) return tokenFor(url);
      if (call.authorization === `Bearer token-${creds.tenantId}`) return json({}, 401);
      return json({ id: '1800' });
    });
    const client = new TeamsApiClient();
    const sent = await client.sendToConversation({
      creds,
      serviceUrl: SERVICE_URL,
      conversationId: '19:c@thread.tacv2;messageid=1700',
      activity: { type: 'message', text: 'hi' },
    });
    expect(sent).toEqual({ activityId: '1800' });
    expect(calls.some((c) => c.url.includes('/botframework.com/oauth2/v2.0/token'))).toBe(true);

    calls.length = 0;
    await client.sendToConversation({
      creds,
      serviceUrl: SERVICE_URL,
      conversationId: '19:c@thread.tacv2;messageid=1700',
      activity: { type: 'message', text: 'again' },
    });
    expect(calls.map((c) => c.authorization)).toEqual(['Bearer token-botframework.com']);
  });

  it('surfaces the Bot Connector error code and marks blocked bots terminal', async () => {
    stubFetch((url) => {
      if (url.includes('login.microsoftonline.com')) return tokenFor(url);
      return json({ error: { code: 'MessageWritesBlocked', message: 'blocked' } }, 403);
    });
    const err = await new TeamsApiClient()
      .sendToConversation({ creds, serviceUrl: SERVICE_URL, conversationId: '19:c@thread.tacv2', activity: { type: 'message' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamsApiError);
    expect((err as TeamsApiError).code).toBe('MessageWritesBlocked');
    expect((err as TeamsApiError).terminal).toBe(true);
  });

  it('reports a 429 with its Retry-After delay and does not treat it as terminal', async () => {
    stubFetch((url) => {
      if (url.includes('login.microsoftonline.com')) return tokenFor(url);
      return json({}, 429, { 'retry-after': '7' });
    });
    const err = await new TeamsApiClient()
      .sendToConversation({ creds, serviceUrl: SERVICE_URL, conversationId: '19:c@thread.tacv2', activity: { type: 'message' } })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 7_000 });
    expect((err as TeamsApiError).terminal).toBe(false);
  });

  it('refuses to send the bot token to a service url outside the Bot Connector hosts', async () => {
    const calls = stubFetch((url) => tokenFor(url));
    await expect(
      new TeamsApiClient().sendToConversation({
        creds,
        serviceUrl: 'https://attacker.test/',
        conversationId: '19:c@thread.tacv2',
        activity: { type: 'message' },
      }),
    ).rejects.toMatchObject({ code: 'service_url_not_allowed' });
    expect(calls.filter((c) => c.url.startsWith('https://attacker.test'))).toHaveLength(0);
  });

  it('keeps the first sentence of the Entra error description for operators', async () => {
    stubFetch(() =>
      json(
        {
          error: 'invalid_request',
          error_description:
            "AADSTS90002: Tenant 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' not found. Check to make sure you have the correct tenant ID.\r\nTrace ID: x",
        },
        400,
      ),
    );
    await expect(new TeamsApiClient().acquireToken(creds)).rejects.toMatchObject({
      code: 'invalid_request',
      fromTokenEndpoint: true,
      tokenDetail: "AADSTS90002: Tenant 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' not found.",
    });
  });

  it('maps a rejected client secret to invalid_client', async () => {
    stubFetch(() => json({ error: 'invalid_client' }, 401));
    await expect(new TeamsApiClient().acquireToken(creds)).rejects.toMatchObject({
      code: 'invalid_client',
      terminal: true,
    });
  });

  it('reads the member email and UPN used for account matching', async () => {
    stubFetch((url) => {
      if (url.includes('login.microsoftonline.com')) return tokenFor(url);
      expect(url).toBe(`${SERVICE_URL}v3/conversations/${encodeURIComponent('19:c@thread.tacv2')}/members/29%3Aop`);
      return json({ id: '29:op', aadObjectId: 'obj-1', name: 'Kari Nordmann', email: 'kari@example.no', userPrincipalName: 'kari@example.no' });
    });
    const member = await new TeamsApiClient().getMember({
      creds,
      serviceUrl: SERVICE_URL,
      conversationId: '19:c@thread.tacv2;messageid=1700',
      memberId: '29:op',
    });
    expect(member).toEqual({
      id: '29:op',
      aadObjectId: 'obj-1',
      name: 'Kari Nordmann',
      email: 'kari@example.no',
      userPrincipalName: 'kari@example.no',
    });
  });
});
