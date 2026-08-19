import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findMcpSurfaceForPath,
  mcpSurfaceAudiences,
  mcpSurfaceMetadataUrl,
  mcpSurfaceResourceUrl,
  mcpSurfaceScopes,
  normalizeMcpSurfacePath,
  resolveMcpSurfaces,
  type McpSurface,
} from './mcp-surface.ts';

const addon: McpSurface = {
  id: 'addon',
  path: '/mcp/addon',
  resourceName: 'Addon',
  scopes: ['addon:write'],
};

describe('resolveMcpSurfaces', () => {
  it('returns an empty list when nothing is registered', () => {
    expect(resolveMcpSurfaces(undefined)).toEqual([]);
    expect(resolveMcpSurfaces([])).toEqual([]);
  });

  it('normalizes a path that omits the leading slash or carries a trailing one', () => {
    const [resolved] = resolveMcpSurfaces([{ ...addon, path: 'mcp/addon/' }]);
    expect(resolved!.path).toBe('/mcp/addon');
  });

  it('rejects a surface that is not below the MCP path', () => {
    expect(() => resolveMcpSurfaces([{ ...addon, path: '/v1/addon' }])).toThrow(/below \/mcp/);
  });

  it('rejects a surface that claims the base MCP path itself', () => {
    expect(() => resolveMcpSurfaces([{ ...addon, path: '/mcp' }])).toThrow(/below \/mcp/);
  });

  it('rejects a duplicate id', () => {
    expect(() => resolveMcpSurfaces([addon, { ...addon, path: '/mcp/other' }])).toThrow(
      /registered twice: addon/,
    );
  });

  it('rejects a duplicate path', () => {
    expect(() => resolveMcpSurfaces([addon, { ...addon, id: 'other' }])).toThrow(
      /registered twice: \/mcp\/addon/,
    );
  });

  it('rejects a surface without an id or resource name', () => {
    expect(() => resolveMcpSurfaces([{ ...addon, id: '  ' }])).toThrow(/missing an id/);
    expect(() => resolveMcpSurfaces([{ ...addon, resourceName: '' }])).toThrow(
      /missing a resourceName/,
    );
  });
});

describe('surface resource identifiers', () => {
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

  it('hangs the surface path off the MCP origin when the base carries a path', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.test/mcp';
    expect(mcpSurfaceResourceUrl(addon)).toBe('https://api.example.test/mcp/addon');
  });

  it('hangs the surface path off the MCP origin when the base is the host root', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    expect(mcpSurfaceResourceUrl(addon)).toBe('https://mcp.example.test/mcp/addon');
  });

  it('derives the metadata document from the authorization server, not the resource host', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    process.env.NEXT_PUBLIC_AUTH_URL = 'https://auth.example.test';
    expect(mcpSurfaceMetadataUrl(addon)).toBe(
      'https://auth.example.test/.well-known/oauth-protected-resource/mcp/addon',
    );
  });

  it('collects audiences and de-duplicates scopes across surfaces', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
    const surfaces = [
      addon,
      { id: 'other', path: '/mcp/other', resourceName: 'Other', scopes: ['addon:write', 'x:read'] },
    ];
    expect(mcpSurfaceAudiences(surfaces)).toEqual([
      'https://mcp.example.test/mcp/addon',
      'https://mcp.example.test/mcp/other',
    ]);
    expect(mcpSurfaceScopes(surfaces)).toEqual(['addon:write', 'x:read']);
  });
});

describe('findMcpSurfaceForPath', () => {
  const surfaces = resolveMcpSurfaces([
    addon,
    { id: 'nested', path: '/mcp/addon/nested', resourceName: 'Nested', scopes: [] },
  ]);

  it('matches the surface path exactly', () => {
    expect(findMcpSurfaceForPath(surfaces, '/mcp/addon')?.id).toBe('addon');
  });

  it('matches paths below the surface', () => {
    expect(findMcpSurfaceForPath(surfaces, '/mcp/addon/session/1')?.id).toBe('addon');
  });

  it('prefers the longest registered path', () => {
    expect(findMcpSurfaceForPath(surfaces, '/mcp/addon/nested')?.id).toBe('nested');
  });

  it('ignores the query string', () => {
    expect(findMcpSurfaceForPath(surfaces, '/mcp/addon?sessionId=1')?.id).toBe('addon');
  });

  it('does not match the base MCP endpoint or a sibling prefix', () => {
    expect(findMcpSurfaceForPath(surfaces, '/mcp')).toBeNull();
    expect(findMcpSurfaceForPath(surfaces, '/mcp/addons')).toBeNull();
  });

  it('normalizes paths without a leading slash', () => {
    expect(normalizeMcpSurfacePath('mcp/addon')).toBe('/mcp/addon');
    expect(findMcpSurfaceForPath(surfaces, 'mcp/addon')?.id).toBe('addon');
  });
});
