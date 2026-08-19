import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentOrgScopedMcpResource,
  isOrgId,
  orgScopedMcpPath,
  orgScopedMcpResourceUrl,
  parseOrgScopedMcpPath,
  parseOrgScopedMcpResource,
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
        resource: `https://mcp.example.test/mcp/o/${ORG_A}`,
      });
    });
    expect(currentOrgScopedMcpResource()).toBeUndefined();
  });

  it('keeps concurrent requests on their own org', async () => {
    const seen: Array<string | undefined> = [];
    const run = (orgId: string, delayTicks: number) =>
      withOrgScopedMcpResource({ resource: `https://mcp.example.test/mcp/o/${orgId}` }, async () => {
        for (let i = 0; i < delayTicks; i += 1) await Promise.resolve();
        seen.push(currentOrgScopedMcpResource()?.orgId);
      });
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

describe('org-scoped MCP scope carries the association key', () => {
  let originalMcp: string | undefined;

  beforeEach(() => {
    originalMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.example.test';
  });

  afterEach(() => {
    if (originalMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = originalMcp;
  });

  it('exposes the association key to whoever pins the org', () => {
    withOrgScopedMcpResource(
      { resource: `https://mcp.example.test/mcp/o/${ORG_A}`, associationKey: 'assoc-key' },
      () => {
        expect(currentOrgScopedMcpResource()).toEqual({
          orgId: ORG_A,
          resource: `https://mcp.example.test/mcp/o/${ORG_A}`,
          associationKey: 'assoc-key',
        });
      },
    );
  });

  it('omits the association key when there is none', () => {
    withOrgScopedMcpResource({ resource: `https://mcp.example.test/mcp/o/${ORG_A}` }, () => {
      expect(currentOrgScopedMcpResource()?.associationKey).toBeUndefined();
    });
  });
});
