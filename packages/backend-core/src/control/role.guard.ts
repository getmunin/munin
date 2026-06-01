import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActorType } from '@getmunin/core';
import { getCurrentContext } from '@getmunin/core';
import { assertOwner, assertOwnerOrAdmin, type OrgRole } from './role-guard.ts';
import { REQUIRE_ACTOR_TYPE_KEY, REQUIRE_ROLE_KEY } from './role.decorator.ts';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const cls = context.getClass();

    const requiredActorTypes = this.reflector.getAllAndOverride<ActorType[] | undefined>(
      REQUIRE_ACTOR_TYPE_KEY,
      [handler, cls],
    );
    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[] | undefined>(
      REQUIRE_ROLE_KEY,
      [handler, cls],
    );

    if (!requiredActorTypes && !requiredRoles) return true;

    const actor = getCurrentContext().actor;
    if (!actor) throw new ForbiddenException('unauthenticated');

    if (requiredActorTypes && requiredActorTypes.length > 0) {
      if (!requiredActorTypes.includes(actor.type)) {
        throw new ForbiddenException(
          `this route requires actor type ${requiredActorTypes.join(' | ')}, got "${actor.type}"`,
        );
      }
    }

    if (requiredRoles && requiredRoles.length > 0) {
      const userId = actor.userId ?? actor.id;
      const wantsOwner = requiredRoles.includes('owner');
      const wantsAdmin = requiredRoles.includes('admin');
      const wantsMember = requiredRoles.includes('member');
      if (wantsMember) {
        throw new Error(
          `RoleGuard: 'member' is not a meaningful gate (all org members pass). ` +
            `Use @RequireActorType('user') instead.`,
        );
      }
      if (wantsOwner && !wantsAdmin) {
        await assertOwner(actor.orgId, userId);
      } else {
        await assertOwnerOrAdmin(actor.orgId, userId);
      }
    }

    return true;
  }
}
