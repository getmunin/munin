import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { AllowAnonymous } from '../common/auth/auth.guard.js';
import { z } from 'zod';
import { CredentialResolver } from '@getmunin/core';
import type { Db } from '@getmunin/db';
import { DB } from '../common/db/db.module.js';
import { InvitationsService } from './invitations.service.js';

const AcceptDto = z.object({
  token: z.string().min(8).max(128),
});

interface AcceptRequest {
  headers: Record<string, string | string[] | undefined>;
  userId?: string;
}

/**
 * Resolve the calling user from a session cookie WITHOUT going through the
 * normal AuthGuard (which calls TenancyInterceptor and would fail because
 * the user isn't a member of the target org yet). We just need the user_id
 * from the session.
 */
@Injectable()
class SessionOnlyGuard implements CanActivate {
  private readonly resolver: CredentialResolver;
  constructor(@Inject(DB) db: Db) {
    this.resolver = new CredentialResolver(db);
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AcceptRequest>();
    const cookieHeader = req.headers['cookie'];
    const cookieValue = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    const sessionToken = readSessionCookie(cookieValue);
    if (!sessionToken) {
      throw new ForbiddenException('not_signed_in');
    }
    // Resolve the session even if there's no membership yet — invitee may
    // be brand new with no orgs, or have a personal org and be joining a team.
    const userId = await resolveUserIdFromSession(this.resolver, sessionToken);
    if (!userId) throw new ForbiddenException('invalid_session');
    req.userId = userId;
    return true;
  }
}

/**
 * Anonymous-cookie accept endpoint. The invitee has signed up or signed
 * in (they have a session cookie) but isn't yet a member of the inviting
 * org, so the regular AuthGuard + TenancyInterceptor pair would fail to
 * route them.
 */
@Controller('api/invitations')
export class AcceptInvitationController {
  constructor(@Inject(InvitationsService) private readonly invites: InvitationsService) {}

  @Get('lookup')
  @AllowAnonymous()
  async lookup(@Query('token') token?: string) {
    if (!token) throw new BadRequestException('token_required');
    const found = await this.invites.lookupByToken(token);
    if (!found) throw new NotFoundException('invitation_not_found_or_expired');
    return found;
  }

  @Post('accept')
  @HttpCode(200)
  @UseGuards(SessionOnlyGuard)
  async accept(@Body() body: unknown, @Req() req: AcceptRequest) {
    const parsed = AcceptDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    if (!req.userId) throw new ForbiddenException('not_signed_in');
    return this.invites.accept({ token: parsed.data.token, userId: req.userId });
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
    const dot = raw.indexOf('.');
    return dot >= 0 ? raw.slice(0, dot) : raw;
  }
  return null;
}

async function resolveUserIdFromSession(
  resolver: CredentialResolver,
  rawToken: string,
): Promise<string | null> {
  // CredentialResolver.resolveSessionToken returns null when the user has
  // no membership; for the accept flow we want the user_id even then.
  // Use the underlying `sessions` table lookup directly via a small private
  // helper exposed as the inner db access. Cleanest: extend CredentialResolver
  // with a session→user-id helper. For now, call the public API; if it
  // returns null and the cookie was present, fall back to a direct sessions
  // lookup.
  const credential = await resolver.resolveSessionToken(rawToken);
  if (credential) return credential.actor.userId ?? credential.actor.id;
  // Fallback: directly look up the session row.
  return resolver.resolveSessionUserId(rawToken);
}
