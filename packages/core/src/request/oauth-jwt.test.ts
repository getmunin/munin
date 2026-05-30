import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acceptedJwtAudiences, jwtIssuer, looksLikeJwt } from './oauth-jwt.ts';

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
  let originalMcp: string | undefined;
  let originalAuth: string | undefined;

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    originalAuth = process.env.NEXT_PUBLIC_AUTH_URL;
  });

  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
    if (originalAuth === undefined) delete process.env.NEXT_PUBLIC_AUTH_URL;
    else process.env.NEXT_PUBLIC_AUTH_URL = originalAuth;
  });

  it('uses origin of NEXT_PUBLIC_MCP_URL as issuer when it has a path and AUTH_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_AUTH_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.com/mcp';
    expect(jwtIssuer()).toBe('https://api.example.com');
  });

  it('uses origin of NEXT_PUBLIC_MCP_URL as issuer when it has no path and AUTH_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_AUTH_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.com';
    expect(jwtIssuer()).toBe('https://mcp.example.com');
  });

  it('uses NEXT_PUBLIC_AUTH_URL verbatim when set (split MCP/auth host topology)', () => {
    process.env.NEXT_PUBLIC_AUTH_URL = 'https://api.getmunin.com';
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.getmunin.com';
    expect(jwtIssuer()).toBe('https://api.getmunin.com');
  });

  it('strips trailing slash from NEXT_PUBLIC_AUTH_URL', () => {
    process.env.NEXT_PUBLIC_AUTH_URL = 'https://api.getmunin.com/';
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.getmunin.com';
    expect(jwtIssuer()).toBe('https://api.getmunin.com');
  });

  it('accepts canonical URL plus trailing-slash, origin, and origin-with-slash when URL has a path', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.com/mcp';
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
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.com';
    expect(acceptedJwtAudiences()).toEqual(
      new Set(['https://mcp.example.com', 'https://mcp.example.com/']),
    );
  });

  it('strips trailing slashes from the env value before computing variants', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.com/mcp/';
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
    delete process.env.NEXT_PUBLIC_MCP_URL;
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
