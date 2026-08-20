import { AsyncLocalStorage } from 'node:async_hooks';
import { stripTrailingSlashes } from '@getmunin/types';

const ORG_ID_PATTERN = /^org_[0-9a-z]{22}$/;

export const MCP_BASE_PATH = '/mcp';

export const ORG_SCOPE_SEGMENT = '/o/';

export const ORG_SCOPED_MCP_PREFIX = `${MCP_BASE_PATH}${ORG_SCOPE_SEGMENT}`;

export const ORG_SCOPE_MARKER_PREFIX = 'mcp:org:';

export interface OrgScopedMcpResource {
  resource: string;
  orgId: string;
  basePath: string;
}

export interface McpOrgScopeInput {
  resource?: string | null;
}

export interface OrgScopedResourcePath {
  basePath: string;
  orgId: string;
}

export function isOrgId(value: string): boolean {
  return ORG_ID_PATTERN.test(value);
}

export function orgScopedPath(basePath: string, orgId: string): string | null {
  const base = stripTrailingSlashes(basePath);
  if (!isMcpResourcePath(base) || !isOrgId(orgId)) return null;
  return `${base}${ORG_SCOPE_SEGMENT}${orgId}`;
}

export function parseOrgScopedPath(path: string): OrgScopedResourcePath | null {
  const clean = stripTrailingSlashes(stripQuery(path));
  const at = clean.lastIndexOf(ORG_SCOPE_SEGMENT);
  if (at < 0) return null;
  const basePath = clean.slice(0, at);
  const orgId = clean.slice(at + ORG_SCOPE_SEGMENT.length);
  if (!isMcpResourcePath(basePath) || !orgId || orgId.includes('/')) return null;
  return isOrgId(orgId) ? { basePath, orgId } : null;
}

export function looksOrgScoped(path: string): boolean {
  const clean = stripQuery(path);
  if (!isMcpResourcePath(stripTrailingSlashes(clean))) return false;
  return clean.includes(ORG_SCOPE_SEGMENT) || stripTrailingSlashes(clean).endsWith('/o');
}

export function orgScopedMcpPath(orgId: string): string {
  return `${ORG_SCOPED_MCP_PREFIX}${orgId}`;
}

export function parseOrgScopedMcpPath(path: string): string | null {
  return parseOrgScopedPath(path)?.orgId ?? null;
}

export function resourceUrlForPath(basePath: string): string | null {
  const origin = mcpOrigin();
  const base = stripTrailingSlashes(basePath);
  if (!origin || !isMcpResourcePath(base)) return null;
  return `${origin}${base}`;
}

export function orgScopedResourceUrl(basePath: string, orgId: string): string | null {
  const origin = mcpOrigin();
  const path = orgScopedPath(basePath, orgId);
  return origin && path ? `${origin}${path}` : null;
}

export function orgScopedMcpResourceUrl(orgId: string): string | null {
  return orgScopedResourceUrl(MCP_BASE_PATH, orgId);
}

function isMcpResourcePath(path: string): boolean {
  return path === MCP_BASE_PATH || path.startsWith(`${MCP_BASE_PATH}/`);
}

export function orgScopeMarkerScope(orgId: string): string | null {
  return isOrgId(orgId) ? `${ORG_SCOPE_MARKER_PREFIX}${orgId}` : null;
}

export function parseOrgScopeMarkerScope(scope: string): string | null {
  const trimmed = scope.trim();
  if (!trimmed.startsWith(ORG_SCOPE_MARKER_PREFIX)) return null;
  const orgId = trimmed.slice(ORG_SCOPE_MARKER_PREFIX.length);
  return isOrgId(orgId) ? orgId : null;
}

export function splitOrgScopeMarker(scopeValue: string): { orgId: string | null; scopes: string } {
  const entries = scopeValue.split(/\s+/).filter(Boolean);
  let orgId: string | null = null;
  const kept: string[] = [];
  for (const entry of entries) {
    const marked = parseOrgScopeMarkerScope(entry);
    if (marked) orgId ??= marked;
    else if (!entry.startsWith(ORG_SCOPE_MARKER_PREFIX)) kept.push(entry);
  }
  return { orgId, scopes: kept.join(' ') };
}

export function parseOrgScopedResource(resource: string): OrgScopedResourcePath | null {
  const origin = mcpOrigin();
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(stripTrailingSlashes(resource));
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  return parseOrgScopedPath(url.pathname);
}

export function parseOrgScopedMcpResource(resource: string): string | null {
  return parseOrgScopedResource(resource)?.orgId ?? null;
}

const OrgScopedResourceStore = new AsyncLocalStorage<OrgScopedMcpResource>();

export function withOrgScopedMcpResource<T>(input: McpOrgScopeInput, fn: () => T): T {
  if (!input.resource) return fn();
  const scoped = parseOrgScopedResource(input.resource);
  if (!scoped) return fn();
  const resource = orgScopedResourceUrl(scoped.basePath, scoped.orgId);
  if (!resource) return fn();
  return OrgScopedResourceStore.run(
    { resource, orgId: scoped.orgId, basePath: scoped.basePath },
    fn,
  );
}

export function currentOrgScopedMcpResource(): OrgScopedMcpResource | undefined {
  return OrgScopedResourceStore.getStore();
}

function mcpOrigin(): string | null {
  const raw = stripTrailingSlashes(process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp');
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
