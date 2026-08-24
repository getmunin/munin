import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BadRequestException, Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { AddressInfo } from 'node:net';
import type { Db } from '@getmunin/db';
import { AuthGuard } from '../../common/auth/auth.guard.ts';
import { DB } from '../../common/db/db.module.ts';
import { ConnectorOAuthController } from './connector-oauth.controller.ts';
import { ConnectorOAuthService } from './connector-oauth.service.ts';

const reached: string[] = [];

const oauthStub = {
  completeAuthorization: (args: { code: string; state: string }) => {
    reached.push(`complete:${args.code}:${args.state}`);
    return Promise.reject(new BadRequestException('connectors_invalid_state'));
  },
};

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
  controllers: [ConnectorOAuthController],
  providers: [
    { provide: DB, useValue: {} as Db },
    { provide: ConnectorOAuthService, useValue: oauthStub },
    AuthGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
class CloudShapedModule {}

describe('connector oauth callback with AuthGuard registered as a global APP_GUARD, as cloud registers it', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(CloudShapedModule, { logger: false, abortOnError: false });
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
    reached.length = 0;
  });

  it('lets the vendor redirect reach the service unauthenticated, which is the only caller it ever has', async () => {
    const res = await fetch(`${baseUrl}/v1/connectors/oauth/callback?code=probe_code&state=probe_state`, {
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    expect(reached).toContain('complete:probe_code:probe_state');
  });

  it('sends a failed exchange back to the dashboard rather than leaking the error to the vendor', async () => {
    const res = await fetch(`${baseUrl}/v1/connectors/oauth/callback?code=c&state=s`, {
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/dashboard/settings/integrations?connector=error');
  });

  it('distinguishes a user declining consent from a broken callback', async () => {
    const denied = await fetch(`${baseUrl}/v1/connectors/oauth/callback?error=access_denied`, {
      redirect: 'manual',
    });
    const broken = await fetch(`${baseUrl}/v1/connectors/oauth/callback`, { redirect: 'manual' });

    expect(denied.headers.get('location')).toContain('connector=denied');
    expect(broken.headers.get('location')).toContain('connector=error');
    expect(reached).toEqual([]);
  });
});
