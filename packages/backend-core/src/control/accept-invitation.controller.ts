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
import { AllowAnonymous } from '../common/auth/auth.guard.ts';
import { sessionCookieNames } from '../auth/auth-cookies.ts';
import { z } from 'zod';
import { CredentialResolver } from '@getmunin/core';
import type { Db } from '@getmunin/db';
import { DB } from '../common/db/db.module.ts';
import { InvitationsService } from './invitations.service.ts';

const AcceptDto = z.object({
  token: z.string().min(8).max(128),
});

interface AcceptRequest {
  headers: Record<string, string | string[] | undefined>;
  userId?: string;
}

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
    const userId = await resolveUserIdFromSession(this.resolver, sessionToken);
    if (!userId) throw new ForbiddenException('invalid_session');
    req.userId = userId;
    return true;
  }
}

@Controller('v1/invitations')
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

function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const names = sessionCookieNames();
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!names.includes(name)) continue;
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
  const credential = await resolver.resolveSessionToken(rawToken);
  if (credential) return credential.actor.userId ?? credential.actor.id;
  return resolver.resolveSessionUserId(rawToken);
}
