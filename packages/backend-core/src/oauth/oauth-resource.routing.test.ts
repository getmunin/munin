import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { OAuthResourceController } from './oauth-resource.controller.ts';
import { ADDITIONAL_MCP_SURFACES, type McpSurface } from './mcp-surface.ts';

const SURFACES: McpSurface[] = [
  { id: 'addon', path: '/mcp/addon', resourceName: 'Addon', scopes: ['addon:write'] },
];

@Module({
  controllers: [OAuthResourceController],
  providers: [{ provide: ADDITIONAL_MCP_SURFACES, useValue: SURFACES }],
})
class MetadataTestModule {}

describe('protected resource metadata routing', () => {
  let app: INestApplication;
  let baseUrl: string;
  let originalMcp: string | undefined;

  beforeAll(async () => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    app = await NestFactory.create(MetadataTestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as { address(): AddressInfo | string | null };
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  it('serves the base document at the unsuffixed well-known path', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resource: string; scopes_supported: string[] };
    expect(body.resource).toBe('https://mcp.example.test');
    expect(body.scopes_supported).not.toContain('addon:write');
  });

  it('serves the surface document at the path-suffixed well-known URL', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp/addon`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as { resource: string; scopes_supported: string[] };
    expect(body.resource).toBe('https://mcp.example.test/mcp/addon');
    expect(body.scopes_supported).toEqual(['offline_access', 'addon:write']);
  });

  it('404s an unregistered suffix instead of falling back to the base document', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp/nope`);
    expect(res.status).toBe(404);
  });
});
