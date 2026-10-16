import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  BadRequestException,
  Controller,
  Get,
  Module,
  type INestApplication,
} from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  ActorIdentity,
  RequestContextStore,
  isInternalError,
  type RequestContext,
} from '@getmunin/core';
import { createDb } from '@getmunin/db';
import { McpToolRegistry, openInProcessMcpClient } from '@getmunin/mcp-toolkit';
import { createApp } from '../bootstrap-app.ts';
import { STORAGE } from './storage/storage.token.ts';

const TEST_URL = process.env.TEST_DATABASE_URL;
const SECRET = 'k3y-that-must-not-leak';

let failedQuery: unknown;

@Controller('internal-error-probe')
class ProbeController {
  @Get('db')
  db(): never {
    throw failedQuery;
  }

  @Get('deliberate')
  deliberate(): never {
    throw new BadRequestException('crm_invalid: email is not a valid address');
  }
}

@Module({ controllers: [ProbeController], providers: [{ provide: STORAGE, useValue: {} }] })
class ProbeModule {}

(TEST_URL ? describe : describe.skip)('internal errors never reach the caller', () => {
  let db: ReturnType<typeof createDb>;
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    db = createDb(TEST_URL!, { serviceRole: true });
    failedQuery = await db
      .execute(sql`SELECT set_config('app.crypt_key', ${SECRET}, true)::int`)
      .then(
        () => null,
        (err: unknown) => err,
      );
    app = await createApp(ProbeModule);
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo };
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('classifies a real failed query from the driver as internal', () => {
    expect(failedQuery).toBeInstanceOf(Error);
    expect((failedQuery as Error).message).toContain(SECRET);
    expect(isInternalError(failedQuery)).toBe(true);
  });

  it('returns the generic internal error from an MCP tool whose query fails', async () => {
    const registry = new McpToolRegistry();
    registry.register(
      {
        name: 'leaky_query',
        description: 'runs a failing query',
        audiences: ['self_service'],
        scopes: [],
        input: z.object({}),
      },
      async () => {
        await db.execute(sql`SELECT set_config('app.crypt_key', ${SECRET}, true)::int`);
        return 'unreachable';
      },
    );
    const actor = new ActorIdentity('end_user_agent', 'eu:1', 'org_x', [], ['self_service'], 'eu_1');
    const audit = { record: vi.fn(() => Promise.resolve()) };
    const client = openInProcessMcpClient({ registry, actor, audience: 'self_service', audit });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx: RequestContext = { db, actor, correlationId: 'corr-leaky' };
      const out = await RequestContextStore.run(ctx, () => client.callTool('leaky_query', {}));
      expect(out.isError).toBe(true);
      expect(out.content[0]!.text).toMatch(/^internal_error: .*ref corr-leaky/);
      expect(out.content[0]!.text).not.toContain(SECRET);
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(SECRET);
      expect(JSON.stringify(audit.record.mock.calls)).toContain(
        'internal_error[DrizzleQueryError:22P02] ref corr-leaky',
      );
      expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET);
    } finally {
      logged.mockRestore();
    }
  });

  it('answers a /v1 request whose query fails with a bare 500 and logs it without the parameters', async () => {
    const written: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/internal-error-probe/db`);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain('set_config');
    const log = written.join('');
    expect(log).toContain('Failed query:');
    expect(log).toContain('params: [redacted]');
    expect(log).not.toContain(SECRET);
  });

  it('passes a deliberate HttpException message through unchanged on /v1', async () => {
    const res = await fetch(`${baseUrl}/internal-error-probe/deliberate`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('crm_invalid: email is not a valid address');
  });
});
