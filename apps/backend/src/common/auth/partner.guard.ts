import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { ResolvedCredential } from '@munin/core';
import type { AuthenticatedRequest } from './auth.guard.js';

interface PartnerRequest extends AuthenticatedRequest {
  credential?: ResolvedCredential;
}

/**
 * Run after AuthGuard. Requires the resolved credential to be a partner key
 * (`actor.type === 'partner'`) with a non-empty `partnerId`. /api/partner/*
 * endpoints use this to keep admin keys out of partner-only flows.
 */
@Injectable()
export class PartnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<PartnerRequest>();
    const actor = req.credential?.actor;
    if (!actor) throw new ForbiddenException('partner key required');
    if (actor.type !== 'partner' || !actor.partnerId) {
      throw new ForbiddenException('partner key required');
    }
    return true;
  }
}
