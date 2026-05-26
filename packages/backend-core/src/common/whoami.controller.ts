import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { getCurrentContext, type ActorIdentity } from '@getmunin/core';
import { AuthGuard } from './auth/auth.guard.ts';
import { TenancyInterceptor } from './tenancy/tenancy.interceptor.ts';
import { AuditInterceptor } from './audit/audit.interceptor.ts';

/**
 * Minimal authenticated endpoint: returns the resolved caller identity.
 *
 * Lets us smoke-test the full chain (AuthGuard → TenancyInterceptor →
 * AuditInterceptor → controller) without needing a real domain module yet.
 */
@Controller('api/v1')
@UseGuards(AuthGuard)
@UseInterceptors(TenancyInterceptor, AuditInterceptor)
export class WhoamiController {
  @Get('whoami')
  whoami(): { actor: SerializedActor; correlationId: string } {
    const ctx = getCurrentContext();
    const actor = ctx.actor!;
    return { actor: serialize(actor), correlationId: ctx.correlationId };
  }
}

interface SerializedActor {
  type: string;
  id: string;
  orgId: string;
  scopes: readonly string[];
  audiences: readonly string[];
  endUserId?: string;
}

function serialize(a: ActorIdentity): SerializedActor {
  return {
    type: a.type,
    id: a.id,
    orgId: a.orgId,
    scopes: a.scopes,
    audiences: a.audiences,
    endUserId: a.endUserId,
  };
}
