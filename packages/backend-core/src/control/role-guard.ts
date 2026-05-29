import { ForbiddenException } from '@nestjs/common';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';

export type OrgRole = 'owner' | 'admin' | 'member';

export const VALID_ROLES: ReadonlySet<string> = new Set<OrgRole>(['owner', 'admin', 'member']);

async function readUserRole(orgId: string, userId: string): Promise<string | null> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

export async function assertOwner(orgId: string, userId: string): Promise<void> {
  const role = await readUserRole(orgId, userId);
  if (role !== 'owner') {
    throw new ForbiddenException('only org owners can perform this action');
  }
}

export async function assertOwnerOrAdmin(orgId: string, userId: string): Promise<void> {
  const actor = getCurrentContext().actor;
  if (!actor) throw new ForbiddenException('unauthenticated');
  if (actor.type === 'system' || actor.type === 'admin_agent') return;
  if (actor.type !== 'user') {
    throw new ForbiddenException('this action requires an owner or admin user');
  }
  const role = await readUserRole(orgId, userId);
  if (role !== 'owner' && role !== 'admin') {
    throw new ForbiddenException('only org owners or admins can perform this action');
  }
}
