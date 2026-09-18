import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Get, Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { AddressInfo } from 'node:net';
import { RATE_LIMITED_CODE } from '@getmunin/types';
import { PublicController } from '../auth/auth.guard.ts';

@PublicController('v1/probe', { throttle: true })
class ProbeController {
  @Get()
  read() {
    return { ok: true };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'public-minute', ttl: 60_000, limit: 1 },
      { name: 'public-hour', ttl: 60 * 60_000, limit: 1_000 },
    ]),
  ],
  controllers: [ProbeController],
})
class ThrottledPublicModule {}

describe('a throttled public route that has run out of budget', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(ThrottledPublicModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected an AddressInfo from app.getHttpServer()');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    const first = await fetch(`${baseUrl}/v1/probe`);
    expect(first.status).toBe(200);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('answers 429 with a machine-readable code, so a caller can tell a rate limit from an empty result', async () => {
    const res = await fetch(`${baseUrl}/v1/probe`);
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe(RATE_LIMITED_CODE);
    expect(body.statusCode).toBe(429);
  });

  it('names the limit and the window it applies to in the message', async () => {
    const res = await fetch(`${baseUrl}/v1/probe`);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/^rate_limited: exceeded 1 requests per minute on this endpoint\./);
  });

  it('carries retryAfterSeconds in the body and an unsuffixed Retry-After header a generic client can back off on', async () => {
    const res = await fetch(`${baseUrl}/v1/probe`);
    const body = (await res.json()) as { retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.headers.get('retry-after')).toBe(String(body.retryAfterSeconds));
  });

  it('keeps the per-throttler headers the named buckets produce', async () => {
    const res = await fetch(`${baseUrl}/v1/probe`);
    expect(res.headers.get('retry-after-public-minute')).not.toBeNull();
  });
});
