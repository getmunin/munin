import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { ResolvedCredential } from '@getmunin/core';

@Injectable()
export class ControlPlaneGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ credential?: ResolvedCredential }>();
    const credential = req.credential;
    if (!credential) {
      throw new UnauthorizedException('unauthenticated');
    }
    const actor = credential.actor;
    if (actor.type === 'system') {
      return true;
    }
    if (actor.type === 'user') {
      if (credential.audience) {
        throw new ForbiddenException(
          'OAuth bearer tokens cannot access control-plane routes; use a session cookie or an admin API key',
        );
      }
      return true;
    }
    if (actor.type === 'admin_agent') {
      if (!actor.hasAudience('admin')) {
        throw new ForbiddenException('admin audience required for control-plane routes');
      }
      if (!actor.hasScope('*')) {
        throw new ForbiddenException(
          'control-plane routes require an unrestricted admin key (scope "*")',
        );
      }
      return true;
    }
    throw new ForbiddenException(
      `actor type "${actor.type}" cannot access control-plane routes`,
    );
  }
}
