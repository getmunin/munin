import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActorIdentity, ActorType, ResolvedCredential } from '@getmunin/core';
import { schema, type Db } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../common/db/db.module.ts';
import { type OrgRole } from './role-guard.ts';
import { REQUIRE_ACTOR_TYPE_KEY, REQUIRE_ROLE_KEY } from './role.decorator.ts';

/**
 * Guards run BEFORE interceptors in Nest's pipeline, so this guard can't
 * use the AsyncLocalStorage context set by TenancyInterceptor. Instead we
 * pull the actor from `req.credential` (attached by AuthGuard) and use
 * the injected service-role DB for the membership lookup.
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
  ) {}

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

    const req = context.switchToHttp().getRequest<{ credential?: ResolvedCredential }>();
    const actor: ActorIdentity | undefined = req.credential?.actor;
    if (!actor) throw new ForbiddenException('unauthenticated');

    if (requiredActorTypes && requiredActorTypes.length > 0) {
      if (!requiredActorTypes.includes(actor.type)) {
        throw new ForbiddenException(
          `this route requires actor type ${requiredActorTypes.join(' | ')}, got "${actor.type}"`,
        );
      }
    }

    if (requiredRoles && requiredRoles.length > 0) {
      if (requiredRoles.includes('member')) {
        throw new Error(
          `RoleGuard: 'member' is not a meaningful gate (all org members pass). ` +
            `Use @RequireActorType('user') instead.`,
        );
      }

      if (actor.type === 'system') return true;
      if (actor.type === 'admin_agent') {
        if (!actor.hasScope('*')) {
          throw new ForbiddenException('scoped admin keys cannot perform owner/admin actions');
        }
        return true;
      }
      if (actor.type !== 'user') {
        throw new ForbiddenException('this action requires an owner or admin user');
      }

      const userId = actor.userId ?? actor.id;
      const role = await this.readUserRole(actor.orgId, userId);
      if (!role) {
        throw new ForbiddenException('not a member of this org');
      }
      if (!requiredRoles.includes(role)) {
        throw new ForbiddenException(
          `this route requires role ${requiredRoles.join(' | ')}, got "${role}"`,
        );
      }
    }

    return true;
  }

  /**
   * Looks up the caller's role in `org_members`. The injected `db` is the
   * service-role connection (which bypasses RLS via its connect-time option),
   * so we don't need the request-scoped tenant transaction here.
   */
  private async readUserRole(orgId: string, userId: string): Promise<OrgRole | null> {
    await this.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const rows = await this.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
      .limit(1);
    return (rows[0]?.role as OrgRole | undefined) ?? null;
  }
}
