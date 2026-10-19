import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { SlackOAuthController } from './slack-oauth.controller.ts';
import { SlackInstallRefusedError, SlackService } from './slack.service.ts';

const AUTHORIZE_URL = 'https://authorize.example/oauth?state=s';

interface BeginCall {
  ticket: unknown;
  sessionToken: string | null;
}
interface CompleteCall {
  code: string;
  state: string;
  sessionNonce: string | null;
  sessionToken: string | null;
}

const begins: BeginCall[] = [];
const completes: CompleteCall[] = [];

const slackStub = {
  beginInstall: (args: BeginCall) => {
    begins.push(args);
    if (!args.sessionToken) {
      return Promise.reject(new SlackInstallRefusedError('signin_required', 'signin'));
    }
    if (args.sessionToken === 'outsider') {
      return Promise.reject(new SlackInstallRefusedError('forbidden', 'forbidden'));
    }
    return Promise.resolve({ orgId: 'org_1', url: AUTHORIZE_URL, sessionNonce: 'nonce-123' });
  },
  completeInstall: (args: CompleteCall) => {
    completes.push(args);
    if (args.sessionToken !== 'admin') {
      return Promise.reject(new SlackInstallRefusedError('forbidden', 'forbidden'));
    }
    return Promise.resolve({ orgId: 'org_1' });
  },
};

@Module({
  controllers: [SlackOAuthController],
  providers: [{ provide: SlackService, useValue: slackStub }],
})
class SlackOAuthModule {}

describe('Slack install routes', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(SlackOAuthModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected an AddressInfo from app.getHttpServer()');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    begins.length = 0;
    completes.length = 0;
  });

  it('sends an install link opened without a Munin session back to sign in, not on to Slack', async () => {
    const res = await fetch(`${baseUrl}/v1/slack/oauth/start?ticket=t`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(
      '/dashboard/settings/integrations?slack=signin_required',
    );
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(begins).toEqual([{ ticket: 't', sessionToken: null }]);
  });

  it('refuses a signed-in person who does not administer the org the link names', async () => {
    const res = await fetch(`${baseUrl}/v1/slack/oauth/start?ticket=t`, {
      redirect: 'manual',
      headers: { cookie: 'better-auth.session_token=outsider.sig' },
    });

    expect(res.headers.get('location')).toContain('slack=forbidden');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('binds the Slack round trip to this browser before redirecting to Slack', async () => {
    const res = await fetch(`${baseUrl}/v1/slack/oauth/start?ticket=t`, {
      redirect: 'manual',
      headers: { cookie: 'better-auth.session_token=admin.sig' },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(AUTHORIZE_URL);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('slack_install_nonce=nonce-123');
    expect(cookie).toContain('Path=/v1/slack/oauth');
    expect(cookie).toContain('HttpOnly');
    expect(begins[0]?.sessionToken).toBe('admin');
  });

  it('hands the callback the nonce cookie and the session of the browser that came back', async () => {
    const ok = await fetch(`${baseUrl}/v1/slack/oauth/callback?code=c&state=s`, {
      redirect: 'manual',
      headers: { cookie: 'slack_install_nonce=nonce-123; better-auth.session_token=admin.sig' },
    });
    expect(ok.headers.get('location')).toContain('slack=connected');
    expect(completes[0]).toEqual({
      code: 'c',
      state: 's',
      sessionNonce: 'nonce-123',
      sessionToken: 'admin',
    });

    const other = await fetch(`${baseUrl}/v1/slack/oauth/callback?code=c&state=s`, {
      redirect: 'manual',
      headers: { cookie: 'slack_install_nonce=nonce-123' },
    });
    expect(other.headers.get('location')).toContain('slack=forbidden');
  });

  it('distinguishes a declined consent from a broken callback', async () => {
    const denied = await fetch(`${baseUrl}/v1/slack/oauth/callback?error=access_denied`, {
      redirect: 'manual',
    });
    const broken = await fetch(`${baseUrl}/v1/slack/oauth/callback`, { redirect: 'manual' });

    expect(denied.headers.get('location')).toContain('slack=denied');
    expect(broken.headers.get('location')).toContain('slack=error');
    expect(completes).toEqual([]);
  });
});
