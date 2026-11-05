import { eq } from 'drizzle-orm';
import { schema } from '@getmunin/db';
import { getCurrentContext } from '@getmunin/core';
import { normalizeAddress } from '../crm/address-deliverability.ts';
import { OutreachInvalidError } from './outreach-errors.ts';

export async function resolveTestRecipient(requested: string | null): Promise<string> {
  const ctx = getCurrentContext();
  const actor = ctx.actor!;
  const members = await ctx.db
    .select({ userId: schema.users.id, email: schema.users.email })
    .from(schema.orgMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
    .where(eq(schema.orgMembers.orgId, actor.orgId));
  if (requested) {
    const wanted = normalizeAddress(requested);
    const match = members.find((m) => normalizeAddress(m.email) === wanted);
    if (!match) {
      throw new OutreachInvalidError(
        `test sends go only to members of this organization; ${requested} is not one`,
      );
    }
    return match.email;
  }
  const self = actor.type === 'user' ? members.find((m) => m.userId === actor.id) : undefined;
  if (!self) {
    throw new OutreachInvalidError(
      'pass `to` with the email address of a member of this organization to receive the test',
    );
  }
  return self.email;
}
