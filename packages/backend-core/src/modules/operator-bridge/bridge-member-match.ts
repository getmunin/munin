import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Db } from '@getmunin/db';

export async function findOrgMemberByEmail(
  db: Db,
  orgId: string,
  candidates: Array<string | null | undefined>,
): Promise<string | null> {
  const emails = [
    ...new Set(
      candidates
        .filter((c): c is string => typeof c === 'string' && c.includes('@'))
        .map((c) => c.trim().toLowerCase()),
    ),
  ];
  if (emails.length === 0) return null;
  const [member] = await db
    .select({ userId: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.users.id))
    .where(and(eq(schema.orgMembers.orgId, orgId), inArray(sql`lower(${schema.users.email})`, emails)))
    .limit(1);
  return member?.userId ?? null;
}

export async function isOrgMember(db: Db, orgId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: schema.orgMembers.userId })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
    .limit(1);
  return row !== undefined;
}
