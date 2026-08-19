import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import {
  OAuthResourceController,
  type ResourceMetadataRequest,
} from './oauth-resource.controller.ts';
import { RESOURCE_ADVERTISED_SCOPES, SUPPORTED_AUTH_SCOPES } from './oauth.constants.ts';
import type { McpSurface } from './mcp-surface.ts';

function requestFor(path: string): ResourceMetadataRequest {
  return { path, url: path };
}

describe('OAuthResourceController', () => {
  let originalUrl: string | undefined;

  beforeEach(() => {
    originalUrl = process.env.NEXT_PUBLIC_MCP_URL;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalUrl;
  });

  it('returns RFC 9728 metadata when NEXT_PUBLIC_MCP_URL carries the /mcp path', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.test/mcp';
    const meta = new OAuthResourceController().metadata();
    expect(meta).toEqual({
      resource: 'https://api.example.test/mcp',
      resource_name: 'Munin',
      resource_logo_uri: 'https://api.example.test/icon.png',
      authorization_servers: ['https://api.example.test'],
      scopes_supported: RESOURCE_ADVERTISED_SCOPES,
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://api.example.test/docs',
      resource_indicators_supported: true,
    });
  });

  it('advertises MCP at the host root when NEXT_PUBLIC_MCP_URL has no path', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    const meta = new OAuthResourceController().metadata();
    expect(meta.resource).toBe('https://mcp.example.test');
    expect(meta.authorization_servers).toEqual(['https://mcp.example.test']);
    expect(meta.resource_documentation).toBe('https://mcp.example.test/docs');
  });

  it('strips trailing slashes from NEXT_PUBLIC_MCP_URL', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.test/mcp/';
    const meta = new OAuthResourceController().metadata();
    expect(meta.resource).toBe('https://api.example.test/mcp');
    expect(meta.authorization_servers).toEqual(['https://api.example.test']);
  });

  it('falls back to localhost when NEXT_PUBLIC_MCP_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_MCP_URL;
    const meta = new OAuthResourceController().metadata();
    expect(meta.resource).toBe('http://localhost:3001/mcp');
  });

  it('exposes the expected scope set', () => {
    const meta = new OAuthResourceController().metadata();
    expect(meta.scopes_supported).toContain('mcp:tools');
    expect(meta.scopes_supported).toContain('kb:read');
    expect(meta.scopes_supported).toContain('conv:write');
    expect(meta.bearer_methods_supported).toEqual(['header']);
  });

  it('advertises offline_access so dynamically registered clients may request refresh tokens', () => {
    const meta = new OAuthResourceController().metadata();
    expect(meta.scopes_supported).toContain('offline_access');
  });

  it('advertises no scope the authorization server would reject', () => {
    const meta = new OAuthResourceController().metadata();
    for (const scope of meta.scopes_supported) {
      expect(SUPPORTED_AUTH_SCOPES).toContain(scope);
    }
  });
});

describe('OAuthResourceController with registered MCP surfaces', () => {
  let originalUrl: string | undefined;

  const surfaces: McpSurface[] = [
    { id: 'addon', path: '/mcp/addon', resourceName: 'Addon', scopes: ['addon:write'] },
  ];

  beforeEach(() => {
    originalUrl = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalUrl;
  });

  it('serves a metadata document for the surface path', () => {
    const meta = new OAuthResourceController(surfaces).surfaceMetadata(requestFor(
      '/.well-known/oauth-protected-resource/mcp/addon',
    ));
    expect(meta.resource).toBe('https://mcp.example.test/mcp/addon');
    expect(meta.resource_name).toBe('Addon');
    expect(meta.scopes_supported).toEqual(['offline_access', 'addon:write']);
    expect(meta.resource_indicators_supported).toBe(true);
  });

  it('serves the same document for paths below the surface', () => {
    const meta = new OAuthResourceController(surfaces).surfaceMetadata(requestFor(
      '/.well-known/oauth-protected-resource/mcp/addon/session/1',
    ));
    expect(meta.resource).toBe('https://mcp.example.test/mcp/addon');
  });

  it('404s for a path no surface claims', () => {
    const controller = new OAuthResourceController(surfaces);
    expect(() =>
      controller.surfaceMetadata(requestFor('/.well-known/oauth-protected-resource/mcp/other')),
    ).toThrow(NotFoundException);
  });

  it('404s for every sub-path when no surface is registered', () => {
    const controller = new OAuthResourceController();
    expect(() =>
      controller.surfaceMetadata(requestFor('/.well-known/oauth-protected-resource/mcp/addon')),
    ).toThrow(NotFoundException);
  });

  it('keeps surface scopes out of the base resource document', () => {
    const meta = new OAuthResourceController(surfaces).metadata();
    expect(meta.resource).toBe('https://mcp.example.test');
    expect(meta.scopes_supported).toEqual(RESOURCE_ADVERTISED_SCOPES);
    expect(meta.scopes_supported).not.toContain('addon:write');
  });

  it('refuses to start when a surface is misconfigured', () => {
    expect(
      () =>
        new OAuthResourceController([
          { id: 'bad', path: '/v1/bad', resourceName: 'Bad', scopes: [] },
        ]),
    ).toThrow(/below \/mcp/);
  });
});
