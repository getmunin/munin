import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { McpToolRegistry } from '@getmunin/mcp-toolkit';
import { McpRegistryService } from '../mcp/mcp.registry.ts';
import { PublicMcpToolsController } from './public-mcp-tools.controller.ts';

class StubRegistry extends McpToolRegistry {}

const SEED = (reg: StubRegistry) => {
  reg.register(
    {
      name: 'kb_search',
      title: 'Search the knowledge base',
      description: 'Full-text search across published KB articles.',
      audiences: ['admin', 'self_service'],
      scopes: ['kb:read'],
      input: z.object({ query: z.string() }),
      readOnlyHint: true,
    },
    () => null,
  );
  reg.register(
    {
      name: 'conv_reply',
      description: 'Append a message to a conversation.',
      audiences: ['admin'],
      scopes: ['conv:write'],
      input: z.object({ conversationId: z.string(), body: z.string() }),
    },
    () => null,
  );
  reg.register(
    {
      name: 'crm_delete_person',
      description: 'Delete a person from the CRM.',
      audiences: ['admin'],
      scopes: ['crm:write'],
      input: z.object({ personId: z.string() }),
      destructiveHint: true,
    },
    () => null,
  );
};

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
  controllers: [PublicMcpToolsController],
  providers: [
    {
      provide: McpRegistryService,
      useFactory: (): StubRegistry => {
        const reg = new StubRegistry();
        SEED(reg);
        return reg;
      },
    },
  ],
})
class TestModule {}

describe('PublicMcpToolsController', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
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

  it('GET /v1/public/mcp-tools lists only self_service tools (admin-only tools hidden)', async () => {
    const res = await fetch(`${baseUrl}/v1/public/mcp-tools`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    const names = body.map((t) => t.name).sort();
    expect(names).toEqual(['kb_search']);
  });

  it('list response carries audiences, scopes, and danger derived from hints', async () => {
    const body = (await (await fetch(`${baseUrl}/v1/public/mcp-tools`)).json()) as Array<
      Record<string, unknown>
    >;
    const search = body.find((t) => t.name === 'kb_search')!;
    expect(search).toMatchObject({
      name: 'kb_search',
      title: 'Search the knowledge base',
      audiences: ['admin', 'self_service'],
      scopes: ['kb:read'],
      readOnly: true,
      danger: null,
    });
    expect(search).not.toHaveProperty('inputSchema');
  });

  it('GET /v1/public/mcp-tools/:name returns the input JSON Schema for self_service tools', async () => {
    const res = await fetch(`${baseUrl}/v1/public/mcp-tools/kb_search`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('kb_search');
    expect(body.inputSchema).toBeTypeOf('object');
    expect((body.inputSchema as { type?: string }).type).toBe('object');
    expect((body.inputSchema as { properties?: object }).properties).toHaveProperty('query');
  });

  it('GET /v1/public/mcp-tools/:name returns 404 for an admin-only tool', async () => {
    const res = await fetch(`${baseUrl}/v1/public/mcp-tools/conv_reply`);
    expect(res.status).toBe(404);
  });

  it('GET /v1/public/mcp-tools/:name returns 404 for unknown name', async () => {
    const res = await fetch(`${baseUrl}/v1/public/mcp-tools/no_such_tool`);
    expect(res.status).toBe(404);
  });

  it('does not require an Authorization header', async () => {
    const list = await fetch(`${baseUrl}/v1/public/mcp-tools`, { headers: {} });
    expect(list.status).toBe(200);
    const detail = await fetch(`${baseUrl}/v1/public/mcp-tools/kb_search`, { headers: {} });
    expect(detail.status).toBe(200);
  });
});
