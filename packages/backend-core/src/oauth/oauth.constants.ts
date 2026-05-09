export const MCP_RESOURCE_PATH = '/mcp';

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
] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];

export function readPublicBaseUrl(): string {
  return (process.env.MUNIN_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

export function mcpResourceUrl(): string {
  return `${readPublicBaseUrl()}${MCP_RESOURCE_PATH}`;
}

export function authorizationServerUrl(): string {
  return readPublicBaseUrl();
}

export function resourceMetadataUrl(): string {
  return `${readPublicBaseUrl()}/.well-known/oauth-protected-resource`;
}
