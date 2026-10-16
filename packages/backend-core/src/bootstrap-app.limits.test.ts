import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Body, Controller, HttpCode, Module, Post, type INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createApp } from './bootstrap-app.ts';
import { STORAGE } from './common/storage/storage.token.ts';

@Controller('v1/a')
class AnalyticsProbeController {
  @Post('t')
  @HttpCode(200)
  echo(@Body() body: Record<string, unknown> | undefined): { keys: number } {
    return { keys: Object.keys(body ?? {}).length };
  }
}

@Controller('v1/other')
class OtherProbeController {
  @Post()
  @HttpCode(200)
  echo(@Body() body: Record<string, unknown> | undefined): { keys: number } {
    return { keys: Object.keys(body ?? {}).length };
  }
}

@Module({
  controllers: [AnalyticsProbeController, OtherProbeController],
  providers: [{ provide: STORAGE, useValue: {} }],
})
class ProbeModule {}

const STRONG = 'Z4kP+yV1c3xQ9bN2mL8wF6rE7tH0jU5o';

describe('createApp production secret check', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ['NODE_ENV', 'MUNIN_KEY_PEPPER', 'MUNIN_ENCRYPTION_KEY'];

  beforeEach(() => {
    for (const key of keys) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('refuses to boot in production with the .env.example pepper', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MUNIN_KEY_PEPPER = 'replace-me-with-strong-random-pepper';
    process.env.MUNIN_ENCRYPTION_KEY = STRONG;
    await expect(createApp(ProbeModule, { logger: false })).rejects.toThrow(
      /MUNIN_KEY_PEPPER looks like a placeholder/,
    );
  });

  it('refuses to boot in production without an encryption key', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MUNIN_KEY_PEPPER = STRONG;
    delete process.env.MUNIN_ENCRYPTION_KEY;
    await expect(createApp(ProbeModule, { logger: false })).rejects.toThrow(
      /MUNIN_ENCRYPTION_KEY is required in production/,
    );
  });
});

describe('createApp analytics ingest body limit', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    app = await createApp(ProbeModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo };
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(path: string, bytes: number): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ key: 'mn_trk_x', pad: 'x'.repeat(bytes) }),
    });
  }

  it('accepts a beacon that fits in what sendBeacon can send', async () => {
    const res = await post('/v1/a/t', 60 * 1024);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keys: 2 });
  });

  it('rejects a beacon body over 64 KB with 413', async () => {
    const res = await post('/v1/a/t', 80 * 1024);
    expect(res.status).toBe(413);
  });

  it('keeps the larger limit on other routes', async () => {
    const res = await post('/v1/other', 80 * 1024);
    expect(res.status).toBe(200);
  });
});
