import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { mcpResourcePaths, resetMcpResourcePaths } from '@getmunin/core';
import { McpSurfacesModule } from './mcp-surfaces.module.ts';
import { OAuthResourceController } from './oauth-resource.controller.ts';
import type { McpSurface } from './mcp-surface.ts';

const SURFACES: McpSurface[] = [
  { id: 'addon', path: '/mcp/addon', resourceName: 'Addon', scopes: ['addon:write'] },
];

@Module({ controllers: [OAuthResourceController] })
class MetadataModule {}

@Module({ imports: [McpSurfacesModule.forRoot(SURFACES), MetadataModule] })
class HostAppModule {}

describe('McpSurfacesModule', () => {
  let app: INestApplication;
  let baseUrl: string;
  let originalMcp: string | undefined;

  beforeAll(async () => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    app = await NestFactory.create(HostAppModule, { logger: false });
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

  it('reaches controllers in other modules without them importing it', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp/addon`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resource: string };
    expect(body.resource).toBe('https://mcp.example.test/mcp/addon');
  });

  it('rejects a misconfigured surface at registration rather than at request time', () => {
    expect(() =>
      McpSurfacesModule.forRoot([{ id: 'bad', path: '/v1/bad', resourceName: 'Bad', scopes: [] }]),
    ).toThrow(/below \/mcp/);
  });

  it('registers the surface with the token layer, which is what makes its audience acceptable', () => {
    resetMcpResourcePaths();
    expect(mcpResourcePaths()).not.toContain('/mcp/addon');
    McpSurfacesModule.forRoot(SURFACES);
    expect(mcpResourcePaths()).toContain('/mcp/addon');
  });
});
