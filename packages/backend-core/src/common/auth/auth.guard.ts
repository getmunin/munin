import { CanActivate, ExecutionContext, Inject, Injectable, Optional, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { CredentialResolver, type ResolvedCredential } from '@getmunin/core';
import type { Db } from '@getmunin/db';
import { DB } from '../db/db.module.ts';
import { Reflector } from '@nestjs/core';
import { mcpResourceUrl, resourceMetadataUrl } from '../../oauth/oauth.constants.ts';

/**
 * Decorator used on routes that should be reachable without auth
 * (signup, oauth discovery). Backed by Nest's `SetMetadata` keyed by a
 * stable string — Symbol() was used originally, but symbol identity
 * across compiled module boundaries proved unreliable in production
 * (well-known OAuth discovery endpoints 401'd even though they had
 * @AllowAnonymous at the method level).
 */
export const ALLOW_ANONYMOUS = 'munin:allow-anonymous';
export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS, true);

/**
 * Extension point: try additional resolvers when the built-in resolver
 * returns null. Downstream packages plug in here to recognize their own
 * key kinds (e.g. partner credentials) without modifying core code.
 */
export const ADDITIONAL_CREDENTIAL_RESOLVERS = Symbol('additionalCredentialResolvers');
export interface AdditionalCredentialResolver {
  resolve(rawKey: string): Promise<ResolvedCredential | null>;
}

/**
 * Internal augmentation of the Express request used inside this app.
 * Kept local rather than declared on `express-serve-static-core` to avoid
 * cross-package module-resolution issues in this monorepo.
 */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  credential?: ResolvedCredential;
}

/**
 * Resolves the bearer token / API key on the incoming request.
 *
 * - Authorization: Bearer <token>            → resolveBearerToken (OAuth or delegated)
 * - Authorization: Bearer mn_<kind>_<rand>   → resolveApiKey, then any registered
 *                                              additional resolvers (cloud plugs in
 *                                              partner-key resolution).
 *
 * On success, attaches `request.credential`. Does NOT open a transaction
 * or set the tenancy context — that's the TenancyInterceptor's job.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly resolver: CredentialResolver;

  constructor(
    @Inject(DB) db: Db,
    private readonly reflector: Reflector,
    @Optional()
    @Inject(ADDITIONAL_CREDENTIAL_RESOLVERS)
    private readonly additionalResolvers: AdditionalCredentialResolver[] = [],
  ) {
    this.resolver = new CredentialResolver(db);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowAnon = this.reflector.getAllAndOverride<boolean>(ALLOW_ANONYMOUS, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
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
    } else {
      const cookieHeader = request.headers['cookie'];
      const cookieValue = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
      const sessionToken = readSessionCookie(cookieValue);
      if (sessionToken) {
        credential = await this.resolver.resolveSessionToken(sessionToken);
      }
    }

    if (!credential) {
      if (allowAnon) return true;
      maybeSetMcpResourceMetadataHeader(context, request);
      throw new UnauthorizedException('invalid or expired credential');
    }

    if (isMcpRequest(request) && credential.audience) {
      if (credential.audience !== mcpResourceUrl()) {
        maybeSetMcpResourceMetadataHeader(context, request);
        throw new UnauthorizedException('token audience does not match the requested resource');
      }
    }

    request.credential = credential;
    return true;
  }
}

function isMcpRequest(request: AuthenticatedRequest & { url?: string; path?: string }): boolean {
  const url = (request.url ?? request.path ?? '').toString();
  return url.startsWith('/mcp');
}

function maybeSetMcpResourceMetadataHeader(
  context: ExecutionContext,
  request: AuthenticatedRequest & { url?: string; path?: string },
): void {
  if (!isMcpRequest(request)) return;
  const res = context.switchToHttp().getResponse<{ setHeader?: (n: string, v: string) => void }>();
  res.setHeader?.(
    'WWW-Authenticate',
    `Bearer resource_metadata="${resourceMetadataUrl()}"`,
  );
}

const SESSION_COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!SESSION_COOKIE_NAMES.includes(name)) continue;
    const raw = decodeURIComponent(part.slice(eq + 1).trim());
    // BetterAuth signs session tokens as `<token>.<signature>`. Both halves
    // are stored in the cookie; we only need the token portion to look up
    // the sessions row, the signature is verified at write time by BA itself.
    const dot = raw.indexOf('.');
    return dot >= 0 ? raw.slice(0, dot) : raw;
  }
  return null;
}

/** Munin API keys are `mn_<kind>_<random>`. Anything else is treated as a bearer/OAuth token. */
function looksLikeApiKey(raw: string): boolean {
  return /^mn_[a-z]+_[A-Za-z0-9_-]+$/.test(raw);
}
