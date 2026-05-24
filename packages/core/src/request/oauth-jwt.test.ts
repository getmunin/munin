import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acceptedJwtAudiences, jwtIssuer, looksLikeJwt } from './oauth-jwt.js';

describe('looksLikeJwt', () => {
  it('accepts three-part dot-delimited strings with non-empty parts', () => {
    expect(looksLikeJwt('aaa.bbb.ccc')).toBe(true);
    expect(looksLikeJwt('eyJhbGciOi.eyJzdWIi.signature')).toBe(true);
  });

  it('rejects strings with fewer or more than three parts', () => {
    expect(looksLikeJwt('aaa.bbb')).toBe(false);
    expect(looksLikeJwt('aaa.bbb.ccc.ddd')).toBe(false);
    expect(looksLikeJwt('nodots')).toBe(false);
  });

  it('rejects strings with any empty part', () => {
    expect(looksLikeJwt('.bbb.ccc')).toBe(false);
    expect(looksLikeJwt('aaa..ccc')).toBe(false);
    expect(looksLikeJwt('aaa.bbb.')).toBe(false);
    expect(looksLikeJwt('')).toBe(false);
  });
});

describe('jwtIssuer + acceptedJwtAudiences', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.MUNIN_MCP_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MUNIN_MCP_URL;
    else process.env.MUNIN_MCP_URL = original;
  });

  it('uses origin of MUNIN_MCP_URL as issuer when it has a path', () => {
    process.env.MUNIN_MCP_URL = 'https://api.example.com/mcp';
    expect(jwtIssuer()).toBe('https://api.example.com');
  });

  it('uses origin of MUNIN_MCP_URL as issuer when it has no path', () => {
    process.env.MUNIN_MCP_URL = 'https://mcp.example.com';
    expect(jwtIssuer()).toBe('https://mcp.example.com');
  });

  it('accepts canonical URL plus trailing-slash, origin, and origin-with-slash when URL has a path', () => {
    process.env.MUNIN_MCP_URL = 'https://api.example.com/mcp';
    expect(acceptedJwtAudiences()).toEqual(
      new Set([
        'https://api.example.com/mcp',
        'https://api.example.com/mcp/',
        'https://api.example.com',
        'https://api.example.com/',
      ]),
    );
  });

  it('accepts both bare-origin variants when URL has no path', () => {
    process.env.MUNIN_MCP_URL = 'https://mcp.example.com';
    expect(acceptedJwtAudiences()).toEqual(
      new Set(['https://mcp.example.com', 'https://mcp.example.com/']),
    );
  });

  it('strips trailing slashes from the env value before computing variants', () => {
    process.env.MUNIN_MCP_URL = 'https://api.example.com/mcp/';
    expect(acceptedJwtAudiences()).toEqual(
      new Set([
        'https://api.example.com/mcp',
        'https://api.example.com/mcp/',
        'https://api.example.com',
        'https://api.example.com/',
      ]),
    );
  });

  it('handles http loopback (dev default) correctly', () => {
    delete process.env.MUNIN_MCP_URL;
    expect(jwtIssuer()).toBe('http://localhost:3001');
    expect(acceptedJwtAudiences()).toEqual(
      new Set([
        'http://localhost:3001/mcp',
        'http://localhost:3001/mcp/',
        'http://localhost:3001',
        'http://localhost:3001/',
      ]),
    );
  });
});
