/**
 * Nest mount path for the MCP controller. External clients see whatever
 * URL `MUNIN_MCP_URL` advertises; the host-based rewriter in
 * `bootstrap-app.ts` maps that external URL to this internal mount path.
 */
export const MCP_INTERNAL_PATH = '/mcp';

/** Back-compat re-export — older callers imported MCP_RESOURCE_PATH. */
export const MCP_RESOURCE_PATH = MCP_INTERNAL_PATH;

export const SUPPORTED_SCOPES = [
  'mcp:tools',
  'mcp:admin',
  'mcp:self_service',
  'kb:read',
  'kb:write',
  'conv:read',
  'conv:write',
  'crm:read',
  'crm:write',
  'cms:read',
  'cms:write',
  'outreach:read',
  'outreach:write',
] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];

const DEFAULT_MCP_URL = 'http://localhost:3001/mcp';

/**
 * `MUNIN_MCP_URL` is the **canonical MCP resource URL** — the URL
 * external clients (claude.ai, the local MCP Inspector, …) configure
 * verbatim. Returned exactly as-is (minus trailing slashes); the OAuth
 * issuer is derived from its origin (scheme + host + port).
 *
 * Cloud sets this to `https://mcp.getmunin.com` (no path); the
 * bootstrap-app middleware rewrites root requests on that host to
 * `/mcp` internally. OSS default keeps the `/mcp` path segment so
 * `http://localhost:3001/mcp` is the canonical URL out of the box.
 */
export function mcpResourceUrl(): string {
  return (process.env.MUNIN_MCP_URL ?? DEFAULT_MCP_URL).replace(/\/+$/, '');
}

/** Origin (scheme + host + port) of `MUNIN_MCP_URL`. The OAuth issuer. */
export function authorizationServerUrl(): string {
  return parsePublicUrl().origin;
}

/**
 * Origin of `MUNIN_MCP_URL` — used by non-MCP code that needs to
 * compose a public URL pointing back at this backend (e.g. email
 * tracking pixel URLs). Kept as an alias of `authorizationServerUrl()`.
 */
export function readPublicBaseUrl(): string {
  return authorizationServerUrl();
}

export function resourceMetadataUrl(): string {
  return `${authorizationServerUrl()}/.well-known/oauth-protected-resource`;
}

/** Hostname of `MUNIN_MCP_URL` — `mcp.getmunin.com`, `localhost`, … */
export function mcpExternalHost(): string {
  return parsePublicUrl().hostname;
}

/**
 * Pathname of `MUNIN_MCP_URL`. Empty string when the resource lives
 * at the host root (e.g. `https://mcp.getmunin.com`). The host-based
 * rewriter uses this to decide which incoming paths to forward to the
 * internal `/mcp` mount.
 */
export function mcpExternalPath(): string {
  const path = parsePublicUrl().pathname;
  return path === '/' ? '' : path.replace(/\/+$/, '');
}

/**
 * Optional canonical REST URL — e.g. `https://api.getmunin.com/v1`. When
 * set, the bootstrap-app rewriter accepts requests on the parsed host
 * whose path starts with the parsed prefix and rewrites them to the
 * internal `/api/v1` mount. Lets the dashboard / external integrations
 * call `/v1/…` without the legacy `/api/v1/…` prefix while keeping
 * every controller path stable internally.
 */
export function apiExternalUrl(): string | null {
  const raw = process.env.MUNIN_API_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

function parsePublicUrl(): URL {
  try {
    return new URL(mcpResourceUrl());
  } catch {
    return new URL(DEFAULT_MCP_URL);
  }
}
