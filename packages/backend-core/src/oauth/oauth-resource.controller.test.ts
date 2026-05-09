import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { OAuthResourceController } from './oauth-resource.controller.js';
import { SUPPORTED_SCOPES } from './oauth.constants.js';

describe('OAuthResourceController', () => {
  let originalUrl: string | undefined;

  beforeEach(() => {
    originalUrl = process.env.MUNIN_PUBLIC_URL;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.MUNIN_PUBLIC_URL;
    else process.env.MUNIN_PUBLIC_URL = originalUrl;
  });

  it('returns RFC 9728 metadata pointing at the configured public URL', () => {
    process.env.MUNIN_PUBLIC_URL = 'https://api.example.test';
    const meta = new OAuthResourceController().metadata();
    expect(meta).toEqual({
      resource: 'https://api.example.test/mcp',
      authorization_servers: ['https://api.example.test'],
      scopes_supported: SUPPORTED_SCOPES,
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://api.example.test/docs',
      resource_indicators_supported: true,
    });
  });

  it('strips trailing slashes from MUNIN_PUBLIC_URL', () => {
    process.env.MUNIN_PUBLIC_URL = 'https://api.example.test/';
    const meta = new OAuthResourceController().metadata();
    expect(meta.resource).toBe('https://api.example.test/mcp');
    expect(meta.authorization_servers).toEqual(['https://api.example.test']);
  });

  it('falls back to localhost when MUNIN_PUBLIC_URL is unset', () => {
    delete process.env.MUNIN_PUBLIC_URL;
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
