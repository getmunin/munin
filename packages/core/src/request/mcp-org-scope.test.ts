import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentOrgScopedMcpResource,
  isOrgId,
  looksOrgScoped,
  orgScopedPath,
  orgScopedResourceUrl,
  parseOrgScopedPath,
  parseOrgScopedResource,
  resourceUrlForPath,
  orgScopeMarkerScope,
  orgScopedMcpPath,
  orgScopedMcpResourceUrl,
  parseOrgScopeMarkerScope,
  parseOrgScopedMcpPath,
  parseOrgScopedMcpResource,
  splitOrgScopeMarker,
  withOrgScopedMcpResource,
} from './mcp-org-scope.ts';

const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaa';
const ORG_B = 'org_bbbbbbbbbbbbbbbbbbbbbb';

describe('org-scoped MCP paths', () => {
  let originalMcp: string | undefined;

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
  });

  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  it('accepts an org id of the minted shape only', () => {
    expect(isOrgId(ORG_A)).toBe(true);
    expect(isOrgId('org_short')).toBe(false);
    expect(isOrgId('usr_aaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(isOrgId('org_AAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
  });

  it('parses the org id out of an org-scoped path', () => {
    expect(parseOrgScopedMcpPath(orgScopedMcpPath(ORG_A))).toBe(ORG_A);
    expect(parseOrgScopedMcpPath(`/mcp/o/${ORG_A}/`)).toBe(ORG_A);
    expect(parseOrgScopedMcpPath(`/mcp/o/${ORG_A}?session=1`)).toBe(ORG_A);
  });

  it('rejects paths that are not a single org segment below /mcp/o/', () => {
    expect(parseOrgScopedMcpPath('/mcp')).toBeNull();
    expect(parseOrgScopedMcpPath('/mcp/media')).toBeNull();
    expect(parseOrgScopedMcpPath('/mcp/o/')).toBeNull();
    expect(parseOrgScopedMcpPath('/mcp/o/not-an-org')).toBeNull();
    expect(parseOrgScopedMcpPath(`/mcp/o/${ORG_A}/media`)).toBeNull();
  });

  it('builds the resource URL from the MCP origin, not its path', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://api.example.test/mcp';
    expect(orgScopedMcpResourceUrl(ORG_A)).toBe(`https://api.example.test/mcp/o/${ORG_A}`);
  });

  it('parses an org-scoped resource URL on the MCP origin', () => {
    expect(parseOrgScopedMcpResource(`https://mcp.example.test/mcp/o/${ORG_A}`)).toBe(ORG_A);
    expect(parseOrgScopedMcpResource(`https://mcp.example.test/mcp/o/${ORG_A}/`)).toBe(ORG_A);
  });

  it('rejects an org-scoped resource URL on another origin', () => {
    expect(parseOrgScopedMcpResource(`https://evil.example.test/mcp/o/${ORG_A}`)).toBeNull();
    expect(parseOrgScopedMcpResource('https://mcp.example.test')).toBeNull();
    expect(parseOrgScopedMcpResource('not a url')).toBeNull();
  });
});

describe('org-scoped MCP request scope', () => {
  let originalMcp: string | undefined;

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
  });

  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  it('exposes the requested org inside the scope and nothing outside it', () => {
    expect(currentOrgScopedMcpResource()).toBeUndefined();
    withOrgScopedMcpResource({ resource: `https://mcp.example.test/mcp/o/${ORG_A}` }, () => {
      expect(currentOrgScopedMcpResource()).toEqual({
        orgId: ORG_A,
        basePath: '/mcp',
        resource: `https://mcp.example.test/mcp/o/${ORG_A}`,
      });
    });
    expect(currentOrgScopedMcpResource()).toBeUndefined();
  });

  it('keeps concurrent requests on their own org', async () => {
    const seen: Array<string | undefined> = [];
    const run = (orgId: string, delayTicks: number) =>
      withOrgScopedMcpResource(
        { resource: `https://mcp.example.test/mcp/o/${orgId}` },
        async () => {
          for (let i = 0; i < delayTicks; i += 1) await Promise.resolve();
          seen.push(currentOrgScopedMcpResource()?.orgId);
        },
      );
    await Promise.all([run(ORG_A, 3), run(ORG_B, 1)]);
    expect(seen.sort()).toEqual([ORG_A, ORG_B]);
  });

  it('runs without a scope when the resource is absent or not org-scoped', () => {
    withOrgScopedMcpResource({ resource: null }, () => {
      expect(currentOrgScopedMcpResource()).toBeUndefined();
    });
    withOrgScopedMcpResource({ resource: 'https://mcp.example.test' }, () => {
      expect(currentOrgScopedMcpResource()).toBeUndefined();
    });
    withOrgScopedMcpResource({ resource: `https://evil.example.test/mcp/o/${ORG_A}` }, () => {
      expect(currentOrgScopedMcpResource()).toBeUndefined();
    });
  });
});

describe('org-scoped paths on any MCP resource', () => {
  let originalMcp: string | undefined;

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
  });

  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  it('hangs an org off a surface path as readily as off the base path', () => {
    expect(parseOrgScopedPath(`/mcp/o/${ORG_A}`)).toEqual({ basePath: '/mcp', orgId: ORG_A });
    expect(parseOrgScopedPath(`/mcp/media/o/${ORG_A}`)).toEqual({
      basePath: '/mcp/media',
      orgId: ORG_A,
    });
    expect(orgScopedPath('/mcp/media', ORG_A)).toBe(`/mcp/media/o/${ORG_A}`);
  });

  it('builds and parses a surface resource identifier', () => {
    expect(orgScopedResourceUrl('/mcp/media', ORG_A)).toBe(
      `https://mcp.example.test/mcp/media/o/${ORG_A}`,
    );
    expect(parseOrgScopedResource(`https://mcp.example.test/mcp/media/o/${ORG_A}`)).toEqual({
      basePath: '/mcp/media',
      orgId: ORG_A,
    });
    expect(resourceUrlForPath('/mcp/media')).toBe('https://mcp.example.test/mcp/media');
  });

  it('refuses a base path outside the MCP tree, so no other endpoint can be org-scoped', () => {
    expect(orgScopedPath('/v1/orgs', ORG_A)).toBeNull();
    expect(parseOrgScopedPath(`/v1/orgs/o/${ORG_A}`)).toBeNull();
    expect(resourceUrlForPath('/v1')).toBeNull();
  });

  it('still refuses a malformed org and a segment below one', () => {
    expect(parseOrgScopedPath('/mcp/media/o/not-an-org')).toBeNull();
    expect(parseOrgScopedPath(`/mcp/media/o/${ORG_A}/session/1`)).toBeNull();
    expect(parseOrgScopedPath(`/mcp/o/${ORG_A}/media`)).toBeNull();
    expect(parseOrgScopedPath('/mcp/media')).toBeNull();
  });

  it('flags anything that looks org-scoped, so a malformed selector can be refused', () => {
    expect(looksOrgScoped(`/mcp/media/o/${ORG_A}`)).toBe(true);
    expect(looksOrgScoped('/mcp/media/o/not-an-org')).toBe(true);
    expect(looksOrgScoped('/mcp/media')).toBe(false);
    expect(looksOrgScoped(`/v1/orgs/o/${ORG_A}`)).toBe(false);
  });

  it('carries the base path into the request scope, so the token can be narrowed to it', () => {
    withOrgScopedMcpResource(
      { resource: `https://mcp.example.test/mcp/media/o/${ORG_A}` },
      () => {
        expect(currentOrgScopedMcpResource()).toEqual({
          orgId: ORG_A,
          basePath: '/mcp/media',
          resource: `https://mcp.example.test/mcp/media/o/${ORG_A}`,
        });
      },
    );
  });
});

describe('org marker scope', () => {
  it('names the org in a scope a client will echo back', () => {
    expect(orgScopeMarkerScope(ORG_A)).toBe(`mcp:org:${ORG_A}`);
    expect(parseOrgScopeMarkerScope(`mcp:org:${ORG_A}`)).toBe(ORG_A);
    expect(parseOrgScopeMarkerScope(` mcp:org:${ORG_A} `)).toBe(ORG_A);
  });

  it('refuses to mint or read a marker for anything but an org id', () => {
    expect(orgScopeMarkerScope('not-an-org')).toBeNull();
    expect(parseOrgScopeMarkerScope('mcp:org:not-an-org')).toBeNull();
    expect(parseOrgScopeMarkerScope('kb:read')).toBeNull();
    expect(parseOrgScopeMarkerScope('mcp:organization')).toBeNull();
  });

  it('splits the marker out of a requested scope list', () => {
    expect(splitOrgScopeMarker(`offline_access mcp:org:${ORG_A} kb:read`)).toEqual({
      orgId: ORG_A,
      scopes: 'offline_access kb:read',
    });
    expect(splitOrgScopeMarker(`mcp:org:${ORG_A}`)).toEqual({ orgId: ORG_A, scopes: '' });
    expect(splitOrgScopeMarker('offline_access  kb:read')).toEqual({
      orgId: null,
      scopes: 'offline_access kb:read',
    });
  });

  it('takes the first marker and drops every malformed one, so none reaches the provider', () => {
    expect(splitOrgScopeMarker(`mcp:org:${ORG_A} mcp:org:${ORG_B} mcp:org:bogus kb:read`)).toEqual({
      orgId: ORG_A,
      scopes: 'kb:read',
    });
  });
});
