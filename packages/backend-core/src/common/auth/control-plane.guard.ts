import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActorIdentity, ResolvedCredential } from '@getmunin/core';
import { schema, type Db } from '@getmunin/db';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../db/db.module.ts';

export const ALLOW_MEMBER = 'munin:allow-member';
export const AllowMember = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_MEMBER, true);

export const MEMBER_FORBIDDEN_CODE = 'member_forbidden';

const ADMIN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

@Injectable()
export class ControlPlaneGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
      await this.assertRoleAdmitted(context, actor);
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

  private async assertRoleAdmitted(
    context: ExecutionContext,
    actor: ActorIdentity,
  ): Promise<void> {
    const allowsMember = this.reflector.getAllAndOverride<boolean>(ALLOW_MEMBER, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowsMember) return;

    const role = actor.orgRole ?? (await this.readOrgRole(actor.orgId, actor.userId ?? actor.id));
    if (role && ADMIN_ROLES.has(role)) return;

    throw new ForbiddenException({
      message: `${MEMBER_FORBIDDEN_CODE}: this route is restricted to owners and admins; your role in this organization is "${role ?? 'none'}"`,
      code: MEMBER_FORBIDDEN_CODE,
    });
  }

  private async readOrgRole(orgId: string, userId: string): Promise<string | null> {
    await this.db.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const rows = await this.db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
      .limit(1);
    return rows[0]?.role ?? null;
  }
}
