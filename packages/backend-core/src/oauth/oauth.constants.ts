export const MCP_INTERNAL_PATH = '/mcp';
export const MCP_RESOURCE_PATH = MCP_INTERNAL_PATH;

export const SUPPORTED_SCOPES = [
  'mcp:tools',
  'mcp:admin',
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
  'analytics:read',
  'analytics:write',
  'webhooks:read',
  'webhooks:write',
  'feedback:read',
  'feedback:write',
  'system_alerts:read',
  'system_alerts:write',
] as const;

export type SupportedScope = (typeof SUPPORTED_SCOPES)[number];

const DEFAULT_MCP_URL = 'http://localhost:3001/mcp';

export function mcpResourceUrl(): string {
  return (process.env.NEXT_PUBLIC_MCP_URL ?? DEFAULT_MCP_URL).replace(/\/+$/, '');
}

export function authorizationServerUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  return parsePublicUrl().origin;
}

export function resourceMetadataUrl(): string {
  return `${authorizationServerUrl()}/.well-known/oauth-protected-resource`;
}

export function mcpResourceOrigin(): string {
  return parsePublicUrl().origin;
}

export function mcpExternalHost(): string {
  return parsePublicUrl().hostname;
}

export function mcpExternalPath(): string {
  const path = parsePublicUrl().pathname;
  return path === '/' ? '' : path.replace(/\/+$/, '');
}

function parsePublicUrl(): URL {
  try {
    return new URL(mcpResourceUrl());
  } catch {
    return new URL(DEFAULT_MCP_URL);
  }
}

