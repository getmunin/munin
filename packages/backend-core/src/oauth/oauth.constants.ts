import { stripTrailingSlashes, SUPPORTED_SCOPES, type SupportedScope } from '@getmunin/types';

export { SUPPORTED_SCOPES, type SupportedScope };

export const MCP_INTERNAL_PATH = '/mcp';
export const MCP_RESOURCE_PATH = MCP_INTERNAL_PATH;

export const STANDARD_OIDC_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;

export const SUPPORTED_AUTH_SCOPES = [...STANDARD_OIDC_SCOPES, ...SUPPORTED_SCOPES] as const;

export const RESOURCE_ADVERTISED_SCOPES = ['offline_access', ...SUPPORTED_SCOPES] as const;

const DEFAULT_MCP_URL = 'http://localhost:3001/mcp';

export function mcpResourceUrl(): string {
  return stripTrailingSlashes(process.env.NEXT_PUBLIC_MCP_URL ?? DEFAULT_MCP_URL);
}

export function authorizationServerUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_AUTH_URL;
  if (explicit) return stripTrailingSlashes(explicit);
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
  return path === '/' ? '' : stripTrailingSlashes(path);
}

function parsePublicUrl(): URL {
  try {
    return new URL(mcpResourceUrl());
  } catch {
    return new URL(DEFAULT_MCP_URL);
  }
}

