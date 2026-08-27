import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ORG_ACCESS_DENIED_CODE, ORG_HEADER } from '@getmunin/types';
import {
  CredentialResolver,
  OrgAccessDeniedError,
  looksOrgScoped,
  orgScopedPath,
  orgScopedResourceUrl,
  parseOrgScopedPath,
  registerMcpResourcePaths,
  type ResolvedCredential,
} from '@getmunin/core';
import type { Db } from '@getmunin/db';
import { DB } from '../db/db.module.ts';
import { Reflector } from '@nestjs/core';
import { mcpResourceUrl, resourceMetadataUrl } from '../../oauth/oauth.constants.ts';
import {
  ADDITIONAL_MCP_SURFACES,
  findMcpSurfaceForPath,
  isSameResourceIdentifier,
  mcpSurfaceMetadataUrl,
  mcpSurfaceResourceUrl,
  resolveMcpSurfaces,
  type McpSurface,
} from '../../oauth/mcp-surface.ts';
import { readSessionCookie } from '../../auth/auth-cookies.ts';

export const ALLOW_ANONYMOUS = 'munin:allow-anonymous';
export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS, true);

export interface PublicControllerOpts {
  throttle?: boolean;
}

export function PublicController(path: string, opts: PublicControllerOpts = {}): ClassDecorator {
  const decorators: ClassDecorator[] = [Controller(path), AllowAnonymous()];
  if (opts.throttle) decorators.push(UseGuards(ThrottlerGuard));
  return applyDecorators(...decorators);
}

export const ADDITIONAL_CREDENTIAL_RESOLVERS = Symbol('additionalCredentialResolvers');
export interface AdditionalCredentialResolver {
  resolve(rawKey: string): Promise<ResolvedCredential | null>;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  credential?: ResolvedCredential;
  url?: string;
  path?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly resolver: CredentialResolver;
  private readonly surfaces: McpSurface[];

  constructor(
    @Inject(DB) db: Db,
    private readonly reflector: Reflector,
    @Optional()
    @Inject(ADDITIONAL_CREDENTIAL_RESOLVERS)
    private readonly additionalResolvers: AdditionalCredentialResolver[] = [],
    @Optional()
    @Inject(ADDITIONAL_MCP_SURFACES)
    surfaces?: readonly McpSurface[],
  ) {
    this.resolver = new CredentialResolver(db);
    this.surfaces = resolveMcpSurfaces(surfaces);
    registerMcpResourcePaths(this.surfaces.map((surface) => surface.path));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowAnon = this.reflector.getAllAndOverride<boolean>(ALLOW_ANONYMOUS, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = requestPath(request);
    if (looksOrgScoped(path) && !parseOrgScopedPath(path)) {
      throw new NotFoundException('not_found');
    }

    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    let credential: ResolvedCredential | null = null;

    if (value && value.toLowerCase().startsWith('bearer ')) {
      const raw = value.slice('Bearer '.length).trim();
      if (raw.startsWith('mn_dlg_')) {
        credential = await this.resolver.resolveBearerToken(raw);
      } else if (looksLikeApiKey(raw)) {
        credential = await this.resolver.resolveApiKey(raw);
        if (!credential) {
          for (const extra of this.additionalResolvers) {
            credential = await extra.resolve(raw);
            if (credential) break;
          }
        }
      } else {
        credential = await this.resolver.resolveBearerToken(raw);
      }
    } else if (!isMcpRequest(request)) {
      const cookieHeader = request.headers['cookie'];
      const cookieValue = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
      const sessionToken = readSessionCookie(cookieValue);
      if (sessionToken) {
        try {
          credential = await this.resolver.resolveSessionToken(
            sessionToken,
            readRequestedOrgId(request),
          );
        } catch (err) {
          if (err instanceof OrgAccessDeniedError) {
            throw new ForbiddenException({ message: err.message, code: ORG_ACCESS_DENIED_CODE });
          }
          throw err;
        }
      }
    }

    if (!credential) {
      if (allowAnon) return true;
      this.maybeSetMcpResourceMetadataHeader(context, request);
      throw new UnauthorizedException('invalid or expired credential');
    }

    if (credential.audience) {
      if (!isMcpRequest(request)) {
        throw new UnauthorizedException(
          'token was issued for the MCP resource and cannot be used on this endpoint',
        );
      }
      if (!this.audienceCoversRequest(credential.audience, request)) {
        this.maybeSetMcpResourceMetadataHeader(context, request);
        throw new UnauthorizedException('token audience does not match the requested resource');
      }
    }

    const orgScopedOrgId = parseOrgScopedPath(path)?.orgId ?? null;
    if (orgScopedOrgId && credential.actor.orgId !== orgScopedOrgId) {
      this.maybeSetMcpResourceMetadataHeader(context, request);
      throw new UnauthorizedException(
        'credential is not valid for the organization addressed by this endpoint',
      );
    }

    request.credential = credential;
    this.echoServingOrg(context, credential);
    return true;
  }

  private echoServingOrg(context: ExecutionContext, credential: ResolvedCredential): void {
    if (!credential.actor.orgId) return;
    const res = context
      .switchToHttp()
      .getResponse<{ setHeader?: (n: string, v: string) => void }>();
    res.setHeader?.(ORG_HEADER, credential.actor.orgId);
  }

  private audienceCoversRequest(audience: string, request: AuthenticatedRequest): boolean {
    const accepted = [mcpResourceUrl()];
    const surface = findMcpSurfaceForPath(this.surfaces, requestPath(request));
    if (surface) accepted.push(mcpSurfaceResourceUrl(surface));
    const scoped = parseOrgScopedPath(requestPath(request));
    if (scoped) {
      const orgResource = orgScopedResourceUrl(scoped.basePath, scoped.orgId);
      if (orgResource) accepted.push(orgResource);
    }
    return accepted.some((resource) => isSameResourceIdentifier(resource, audience));
  }

  private maybeSetMcpResourceMetadataHeader(
    context: ExecutionContext,
    request: AuthenticatedRequest,
  ): void {
    if (!isMcpRequest(request)) return;
    const surface = findMcpSurfaceForPath(this.surfaces, requestPath(request));
    const scoped = parseOrgScopedPath(requestPath(request));
    const orgScopedPathname = scoped ? orgScopedPath(scoped.basePath, scoped.orgId) : null;
    const metadata = orgScopedPathname
      ? `${resourceMetadataUrl()}${orgScopedPathname}`
      : surface
        ? mcpSurfaceMetadataUrl(surface)
        : resourceMetadataUrl();
    const res = context
      .switchToHttp()
      .getResponse<{ setHeader?: (n: string, v: string) => void }>();
    res.setHeader?.('WWW-Authenticate', `Bearer resource_metadata="${metadata}"`);
  }
}

function readRequestedOrgId(request: AuthenticatedRequest): string | null {
  const raw = request.headers[ORG_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isMcpRequest(request: AuthenticatedRequest): boolean {
  return requestPath(request).startsWith('/mcp');
}

function requestPath(request: AuthenticatedRequest): string {
  const raw = (request.url ?? request.path ?? '').toString();
  const i = raw.indexOf('?');
  return i < 0 ? raw : raw.slice(0, i);
}

function looksLikeApiKey(raw: string): boolean {
  return /^mn_[a-z]+_[A-Za-z0-9_-]+$/.test(raw);
}
