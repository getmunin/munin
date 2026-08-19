import { Get, Header, Inject, NotFoundException, Optional, Req } from '@nestjs/common';
import { orgScopedMcpResourceUrl, parseOrgScopedMcpPath } from '@getmunin/core';
import { PublicController } from '../common/auth/auth.guard.ts';
import {
  authorizationServerUrl,
  mcpResourceOrigin,
  mcpResourceUrl,
  RESOURCE_ADVERTISED_SCOPES,
} from './oauth.constants.ts';
import {
  ADDITIONAL_MCP_SURFACES,
  findMcpSurfaceForPath,
  mcpSurfaceResourceUrl,
  resolveMcpSurfaces,
  type McpSurface,
} from './mcp-surface.ts';

interface ProtectedResourceMetadata {
  resource: string;
  resource_name: string;
  resource_logo_uri: string;
  authorization_servers: string[];
  scopes_supported: readonly string[];
  bearer_methods_supported: readonly string[];
  resource_documentation?: string;
  resource_indicators_supported: boolean;
}

export interface ResourceMetadataRequest {
  path?: string;
  url?: string;
}

const METADATA_PREFIX = '/.well-known/oauth-protected-resource';

@PublicController('.well-known/oauth-protected-resource')
export class OAuthResourceController {
  private readonly surfaces: McpSurface[];

  constructor(
    @Optional()
    @Inject(ADDITIONAL_MCP_SURFACES)
    surfaces?: readonly McpSurface[],
  ) {
    this.surfaces = resolveMcpSurfaces(surfaces);
  }

  @Get()
  @Header('content-type', 'application/json; charset=utf-8')
  @Header('cache-control', 'public, max-age=3600')
  metadata(): ProtectedResourceMetadata {
    return {
      resource: mcpResourceUrl(),
      resource_name: 'Munin',
      resource_logo_uri: `${mcpResourceOrigin()}/icon.png`,
      authorization_servers: [authorizationServerUrl()],
      scopes_supported: RESOURCE_ADVERTISED_SCOPES,
      bearer_methods_supported: ['header'],
      resource_documentation: `${authorizationServerUrl()}/docs`,
      resource_indicators_supported: true,
    };
  }

  @Get('*path')
  @Header('content-type', 'application/json; charset=utf-8')
  @Header('cache-control', 'public, max-age=3600')
  surfaceMetadata(@Req() req: ResourceMetadataRequest): ProtectedResourceMetadata {
    const suffix = suffixOf(req);
    const orgScopedResource = orgScopedResourceFor(suffix);
    if (orgScopedResource) {
      return {
        resource: orgScopedResource,
        resource_name: 'Munin',
        resource_logo_uri: `${mcpResourceOrigin()}/icon.png`,
        authorization_servers: [authorizationServerUrl()],
        scopes_supported: RESOURCE_ADVERTISED_SCOPES,
        bearer_methods_supported: ['header'],
        resource_documentation: `${authorizationServerUrl()}/docs`,
        resource_indicators_supported: true,
      };
    }
    const surface = findMcpSurfaceForPath(this.surfaces, suffix);
    if (!surface) throw new NotFoundException('protected_resource_not_found');
    return {
      resource: mcpSurfaceResourceUrl(surface),
      resource_name: surface.resourceName,
      resource_logo_uri: `${mcpResourceOrigin()}/icon.png`,
      authorization_servers: [authorizationServerUrl()],
      scopes_supported: ['offline_access', ...surface.scopes],
      bearer_methods_supported: ['header'],
      resource_documentation: surface.documentationUrl ?? `${authorizationServerUrl()}/docs`,
      resource_indicators_supported: true,
    };
  }
}

function orgScopedResourceFor(suffix: string): string | null {
  const orgId = parseOrgScopedMcpPath(suffix);
  return orgId ? orgScopedMcpResourceUrl(orgId) : null;
}

function suffixOf(req: ResourceMetadataRequest): string {
  const raw = (req.path ?? req.url ?? '').toString();
  const at = raw.indexOf(METADATA_PREFIX);
  return at < 0 ? raw : raw.slice(at + METADATA_PREFIX.length);
}
