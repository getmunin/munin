import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { OAuthResourceController } from './oauth-resource.controller.ts';
import { SUPPORTED_SCOPES } from './oauth.constants.ts';

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
      scopes_supported: SUPPORTED_SCOPES,
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
});
