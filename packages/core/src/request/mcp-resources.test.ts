import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canonicalMcpResource,
  mcpResourcePaths,
  mcpResourceUrls,
  registerMcpResourcePaths,
  resetMcpResourcePaths,
} from './mcp-resources.ts';
import { acceptedJwtAudiences } from './oauth-jwt.ts';

describe('registered MCP resources', () => {
  let originalMcp: string | undefined;

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    resetMcpResourcePaths();
  });

  afterEach(() => {
    resetMcpResourcePaths();
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  it('registers nothing by default', () => {
    expect(mcpResourcePaths()).toEqual([]);
    expect(mcpResourceUrls()).toEqual([]);
  });

  it('normalizes and de-duplicates registered paths', () => {
    registerMcpResourcePaths(['/mcp/media', 'mcp/media/', '/mcp/media']);
    expect(mcpResourcePaths()).toEqual(['/mcp/media']);
  });

  it('hangs registered paths off the MCP origin, not its path', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    registerMcpResourcePaths(['/mcp/media']);
    expect(mcpResourceUrls()).toEqual(['https://mcp.example.test/mcp/media']);

    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.test/mcp';
    expect(mcpResourceUrls()).toEqual(['https://api.example.test/mcp/media']);
  });

  it('accepts a JWT audience naming a registered resource', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    expect(acceptedJwtAudiences().has('https://mcp.example.test/mcp/media')).toBe(false);
    registerMcpResourcePaths(['/mcp/media']);
    expect(acceptedJwtAudiences().has('https://mcp.example.test/mcp/media')).toBe(true);
    expect(acceptedJwtAudiences().has('https://mcp.example.test/mcp/media/')).toBe(true);
  });

  it('keeps rejecting an audience no surface claims', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    registerMcpResourcePaths(['/mcp/media']);
    expect(acceptedJwtAudiences().has('https://mcp.example.test/mcp/other')).toBe(false);
    expect(acceptedJwtAudiences().has('https://evil.example.test/mcp/media')).toBe(false);
  });

  it('reports a registered resource audience as itself', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    registerMcpResourcePaths(['/mcp/media']);
    expect(canonicalMcpResource('https://mcp.example.test/mcp/media')).toBe(
      'https://mcp.example.test/mcp/media',
    );
    expect(canonicalMcpResource('https://mcp.example.test/mcp/media/')).toBe(
      'https://mcp.example.test/mcp/media',
    );
  });

  it('folds every other accepted audience shape onto the base resource', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.test/mcp';
    registerMcpResourcePaths(['/mcp/media']);
    expect(canonicalMcpResource('https://api.example.test')).toBe('https://api.example.test/mcp');
    expect(canonicalMcpResource('https://api.example.test/')).toBe('https://api.example.test/mcp');
    expect(canonicalMcpResource('https://api.example.test/mcp')).toBe(
      'https://api.example.test/mcp',
    );
  });
});
