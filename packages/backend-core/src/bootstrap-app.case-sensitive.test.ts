import 'reflect-metadata';
import { Controller, Module, Post, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCaseSensitiveExpress } from './bootstrap-app.ts';

@Controller('mcp')
class ProbeController {
  @Post()
  post() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('createCaseSensitiveExpress', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create(ProbeModule, new ExpressAdapter(createCaseSensitiveExpress()), {
      logger: false,
    });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('routes the declared lowercase path', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it.each(['/MCP', '/Mcp', '/mCp'])(
    'does not route %s to a controller declared as /mcp, so path-prefix checks see the same path the router does',
    async (path) => {
      const res = await fetch(`${base}${path}`, { method: 'POST' });
      expect(res.status).toBe(404);
    },
  );
});
