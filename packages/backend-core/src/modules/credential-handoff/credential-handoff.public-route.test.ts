import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Module, NotFoundException, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { AddressInfo } from 'node:net';
import type { Db } from '@getmunin/db';
import { AuthGuard } from '../../common/auth/auth.guard.ts';
import { DB } from '../../common/db/db.module.ts';
import { CredentialHandoffController } from './credential-handoff.controller.ts';
import { CredentialHandoffService } from './credential-handoff.service.ts';

const reached: string[] = [];

const handoffStub = {
  describe: (token: string) => {
    reached.push(`describe:${token}`);
    return Promise.reject(
      new NotFoundException('credential_handoff_not_found: invalid or expired link'),
    );
  },
  complete: (token: string) => {
    reached.push(`complete:${token}`);
    return Promise.reject(
      new NotFoundException('credential_handoff_not_found: invalid or expired link'),
    );
  },
};

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
  controllers: [CredentialHandoffController],
  providers: [
    { provide: DB, useValue: {} as Db },
    { provide: CredentialHandoffService, useValue: handoffStub },
    AuthGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
class CloudShapedModule {}

describe('credential-handoff routes with AuthGuard registered as a global APP_GUARD, as cloud registers it', () => {
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

  it('lets an unauthenticated describe reach the handoff service, which is the only caller a one-time link ever has', async () => {
    const res = await fetch(`${baseUrl}/v1/credentials?token=mncl_probe_describe`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain('invalid or expired link');
    expect(reached).toContain('describe:mncl_probe_describe');
  });

  it('lets an unauthenticated complete reach the handoff service', async () => {
    const res = await fetch(`${baseUrl}/v1/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'mncl_probe_complete', secrets: { smtpPassword: 'pw' } }),
    });
    expect(res.status).toBe(404);
    expect(reached).toContain('complete:mncl_probe_complete');
  });
});
