import { AsyncLocalStorage } from 'node:async_hooks';
import { stripTrailingSlashes } from '@getmunin/types';

const ORG_ID_PATTERN = /^org_[0-9a-z]{22}$/;

export const ORG_SCOPED_MCP_PREFIX = '/mcp/o/';

export interface OrgScopedMcpResource {
  resource: string;
  orgId: string;
  associationKey?: string;
}

export interface McpOrgScopeInput {
  resource?: string | null;
  associationKey?: string | null;
}

export function isOrgId(value: string): boolean {
  return ORG_ID_PATTERN.test(value);
}

export function orgScopedMcpPath(orgId: string): string {
  return `${ORG_SCOPED_MCP_PREFIX}${orgId}`;
}

export function parseOrgScopedMcpPath(path: string): string | null {
  const clean = stripTrailingSlashes(stripQuery(path));
  if (!clean.startsWith(ORG_SCOPED_MCP_PREFIX)) return null;
  const rest = clean.slice(ORG_SCOPED_MCP_PREFIX.length);
  if (!rest || rest.includes('/')) return null;
  return isOrgId(rest) ? rest : null;
}

export function orgScopedMcpResourceUrl(orgId: string): string | null {
  const origin = mcpOrigin();
  if (!origin || !isOrgId(orgId)) return null;
  return `${origin}${orgScopedMcpPath(orgId)}`;
}

export function parseOrgScopedMcpResource(resource: string): string | null {
  const origin = mcpOrigin();
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(stripTrailingSlashes(resource));
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  return parseOrgScopedMcpPath(url.pathname);
}

const OrgScopedResourceStore = new AsyncLocalStorage<OrgScopedMcpResource>();

export function withOrgScopedMcpResource<T>(input: McpOrgScopeInput, fn: () => T): T {
  if (!input.resource) return fn();
  const orgId = parseOrgScopedMcpResource(input.resource);
  if (!orgId) return fn();
  const resource = orgScopedMcpResourceUrl(orgId);
  if (!resource) return fn();
  const scope: OrgScopedMcpResource = { resource, orgId };
  if (input.associationKey) scope.associationKey = input.associationKey;
  return OrgScopedResourceStore.run(scope, fn);
}

export function currentOrgScopedMcpResource(): OrgScopedMcpResource | undefined {
  return OrgScopedResourceStore.getStore();
}

function mcpOrigin(): string | null {
  const raw = stripTrailingSlashes(
    process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp',
  );
  try {
    return new URL(raw).origin;
  } catch (err) {
    console.warn('[mcp-org-scope] NEXT_PUBLIC_MCP_URL is not a parseable URL', { err });
    return null;
  }
}

function stripQuery(path: string): string {
  const i = path.indexOf('?');
  return i < 0 ? path : path.slice(0, i);
}
