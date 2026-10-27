import { createHash } from 'node:crypto';
import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';

export async function emailTemplateHash(templateId: string | null): Promise<string | null> {
  const ctx = getCurrentContext();
  const t = schema.outreachEmailTemplates;
  const [row] = await ctx.db
    .select({ mjml: t.mjml })
    .from(t)
    .where(templateId ? eq(t.id, templateId) : and(eq(t.orgId, ctx.actor!.orgId), eq(t.isDefault, true)))
    .limit(1);
  if (templateId && !row) return null;
  const mjml = row?.mjml ?? (await import('./email-template-render.ts')).BUILT_IN_EMAIL_TEMPLATE;
  return createHash('sha256').update(mjml, 'utf8').digest('hex').slice(0, 32);
}
