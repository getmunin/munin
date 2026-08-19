import { stripTrailingSlashes } from '@getmunin/types';
import { MCP_INTERNAL_PATH, mcpResourceOrigin, resourceMetadataUrl } from './oauth.constants.ts';

export const ADDITIONAL_MCP_SURFACES = Symbol('additionalMcpSurfaces');

export interface McpSurface {
  id: string;
  path: string;
  resourceName: string;
  scopes: readonly string[];
  documentationUrl?: string;
}

export function normalizeMcpSurfacePath(path: string): string {
  const trimmed = stripTrailingSlashes(path.trim());
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function resolveMcpSurfaces(surfaces: readonly McpSurface[] | undefined): McpSurface[] {
  if (!surfaces?.length) return [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  return surfaces.map((surface) => {
    const id = surface.id?.trim() ?? '';
    if (!id) throw new Error('mcp surface is missing an id');
    if (seenIds.has(id)) throw new Error(`mcp surface id is registered twice: ${id}`);
    seenIds.add(id);

    const path = normalizeMcpSurfacePath(surface.path ?? '');
    if (path === MCP_INTERNAL_PATH || !path.startsWith(`${MCP_INTERNAL_PATH}/`)) {
      throw new Error(
        `mcp surface ${id} must declare a path below ${MCP_INTERNAL_PATH}/, got ${surface.path}`,
      );
    }
    if (seenPaths.has(path)) throw new Error(`mcp surface path is registered twice: ${path}`);
    seenPaths.add(path);

    if (!surface.resourceName?.trim()) throw new Error(`mcp surface ${id} is missing a resourceName`);

    return { ...surface, id, path };
  });
}

export function mcpSurfaceResourceUrl(surface: McpSurface): string {
  return `${mcpResourceOrigin()}${normalizeMcpSurfacePath(surface.path)}`;
}

export function mcpSurfaceMetadataUrl(surface: McpSurface): string {
  return `${resourceMetadataUrl()}${normalizeMcpSurfacePath(surface.path)}`;
}

export function isSameResourceIdentifier(a: string, b: string): boolean {
  return stripTrailingSlashes(a) === stripTrailingSlashes(b);
}

export function findMcpSurfaceForPath(
  surfaces: readonly McpSurface[],
  requestPath: string,
): McpSurface | null {
  const path = normalizeMcpSurfacePath(stripQuery(requestPath));
  if (!path) return null;
  let match: McpSurface | null = null;
  for (const surface of surfaces) {
    const candidate = normalizeMcpSurfacePath(surface.path);
    if (path !== candidate && !path.startsWith(`${candidate}/`)) continue;
    if (!match || candidate.length > normalizeMcpSurfacePath(match.path).length) match = surface;
  }
  return match;
}

export function mcpSurfaceAudiences(surfaces: readonly McpSurface[]): string[] {
  return surfaces.map((surface) => mcpSurfaceResourceUrl(surface));
}

export function mcpSurfaceScopes(surfaces: readonly McpSurface[]): string[] {
  return Array.from(new Set(surfaces.flatMap((surface) => [...surface.scopes])));
}

function stripQuery(path: string): string {
  const i = path.indexOf('?');
  return i < 0 ? path : path.slice(0, i);
}
