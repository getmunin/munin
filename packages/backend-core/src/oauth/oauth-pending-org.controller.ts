import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { getCurrentContext } from '@getmunin/core';
import { AuthGuard } from '../common/auth/auth.guard.ts';
import { ControlPlaneGuard } from '../common/auth/control-plane.guard.ts';
import { TenancyInterceptor } from '../common/tenancy/tenancy.interceptor.ts';
import { orgScopeStore } from '../auth/org-scope-store.ts';

export interface PendingAuthorizationOrgDto {
  pinned: boolean;
  orgId?: string;
}

interface CookieCarryingRequest {
  headers: Record<string, string | string[] | undefined>;
}

@Controller('v1/oauth/pending-org')
@UseGuards(AuthGuard, ControlPlaneGuard)
@UseInterceptors(TenancyInterceptor)
export class OAuthPendingOrgController {
  @Get()
  @Header('cache-control', 'no-store')
  async pending(
    @Req() req: CookieCarryingRequest,
    @Query('code_challenge') codeChallenge?: string,
  ): Promise<PendingAuthorizationOrgDto> {
    const actor = getCurrentContext().actor!;
    if (actor.type !== 'user' || !actor.userId) {
      throw new ForbiddenException('user session required');
    }

    const store = orgScopeStore();
    if (!store || !codeChallenge) return { pinned: false };

    const cookieHeader = req.headers['cookie'];
    const key = store.keyFor(
      Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader,
      codeChallenge,
    );
    if (!key) return { pinned: false };

    const orgId = await store.recall(key);
    return orgId ? { pinned: true, orgId } : { pinned: false };
  }
}
