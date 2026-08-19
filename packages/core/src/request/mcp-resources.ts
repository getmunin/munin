import { stripTrailingSlashes } from '@getmunin/types';
import { parseOrgScopedMcpResource } from './mcp-org-scope.ts';

const registeredPaths = new Set<string>();

export function registerMcpResourcePaths(paths: readonly string[]): void {
  for (const raw of paths) {
    const path = normalizeResourcePath(raw);
    if (path) registeredPaths.add(path);
  }
}

export function resetMcpResourcePaths(): void {
  registeredPaths.clear();
}

export function mcpResourcePaths(): string[] {
  return Array.from(registeredPaths);
}

export function mcpResourceBase(): string {
  return stripTrailingSlashes(process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp');
}

export function mcpResourceUrls(): string[] {
  const origin = mcpResourceOriginOrNull();
  if (!origin) return [];
  return mcpResourcePaths().map((path) => `${origin}${path}`);
}

export function canonicalMcpResource(audience: string): string {
  const candidate = stripTrailingSlashes(audience);
  if (parseOrgScopedMcpResource(candidate)) return candidate;
  for (const url of mcpResourceUrls()) {
    if (candidate === url) return url;
  }
  return mcpResourceBase();
}

function mcpResourceOriginOrNull(): string | null {
  try {
    return new URL(mcpResourceBase()).origin;
  } catch (err) {
    console.warn('[mcp-resources] NEXT_PUBLIC_MCP_URL is not a parseable URL', { err });
    return null;
  }
}

function normalizeResourcePath(raw: string): string {
  const trimmed = stripTrailingSlashes(raw.trim());
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
