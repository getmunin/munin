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
 * - Authorization: Bearer mn_admin_<rand>    → resolveApiKey
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
    let credential: ResolvedCredential | null = null;

    if (value && value.toLowerCase().startsWith('bearer ')) {
      const raw = value.slice('Bearer '.length).trim();
      credential = looksLikeApiKey(raw)
        ? await this.resolver.resolveApiKey(raw)
        : await this.resolver.resolveBearerToken(raw);
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
      throw new UnauthorizedException('invalid or expired credential');
    }

    request.credential = credential;
    return true;
  }
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
  return /^mn_(admin|dlg)_[A-Za-z0-9_-]+$/.test(raw);
}
