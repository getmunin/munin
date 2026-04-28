import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { CredentialResolver, type ResolvedCredential } from '@munin/core';
import type { Db } from '@munin/db';
import { DB } from '../db/db.module.js';
import { Reflector } from '@nestjs/core';

/** Decorator used on routes that should be reachable without auth (signup, oauth discovery). */
export const ALLOW_ANONYMOUS = Symbol('allowAnonymous');
export const AllowAnonymous = () => Reflect.metadata(ALLOW_ANONYMOUS, true);

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
 * - Authorization: Bearer <prefix>_<rand>    → resolveApiKey (admin / partner)
 *
 * The same header is used for both — the resolver tries API key first when
 * the value matches the `<prefix>_<rest>` shape, otherwise bearer token.
 *
 * On success, attaches `request.credential`. Does NOT open a transaction
 * or set the tenancy context — that's the TenancyInterceptor's job.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly resolver: CredentialResolver;

  constructor(@Inject(DB) db: Db, private readonly reflector: Reflector) {
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

    if (!value || !value.toLowerCase().startsWith('bearer ')) {
      if (allowAnon) return true;
      throw new UnauthorizedException('missing bearer token');
    }

    const raw = value.slice('Bearer '.length).trim();
    const credential = looksLikeApiKey(raw)
      ? await this.resolver.resolveApiKey(raw)
      : await this.resolver.resolveBearerToken(raw);

    if (!credential) {
      if (allowAnon) return true;
      throw new UnauthorizedException('invalid or expired credential');
    }

    request.credential = credential;
    return true;
  }
}

/** Heuristic: API keys are `<prefix>_<base64url>`; OAuth tokens are pure JWT or base64url with no prefix. */
function looksLikeApiKey(raw: string): boolean {
  return /^[a-z]{3,8}_[A-Za-z0-9_-]{16,}$/.test(raw);
}
