import { schema } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { BUILT_IN_EMAIL_TEMPLATE } from './email-template-render.ts';

export async function emailTemplateMjml(templateId: string | null): Promise<string | null> {
  const ctx = getCurrentContext();
  const t = schema.outreachEmailTemplates;
  const [row] = await ctx.db
    .select({ mjml: t.mjml })
    .from(t)
    .where(templateId ? eq(t.id, templateId) : and(eq(t.orgId, ctx.actor!.orgId), eq(t.isDefault, true)))
    .limit(1);
  if (templateId && !row) return null;
  return row?.mjml ?? BUILT_IN_EMAIL_TEMPLATE;
}
