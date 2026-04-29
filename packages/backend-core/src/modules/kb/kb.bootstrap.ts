import { schema } from '@getmunin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@getmunin/core';
import { BootstrapRunner, defineStep } from '@getmunin/bootstrap';
import { z } from 'zod';

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

const FirstSpaceSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(SLUG_REGEX),
});

const WelcomeDocSchema = z.object({
  /** Pass `false` to skip seeding a starter doc; otherwise it is created. */
  create: z.boolean().default(true),
  /** Override the title; default is "How we work". */
  title: z.string().min(1).max(300).optional(),
  /** Override the body; default is a stub the agent can fill in. */
  body: z.string().min(1).optional(),
});

const firstSpace = defineStep({
  id: 'first_space',
  prompt:
    'Pick a name and short slug for your first knowledge-base space. The slug becomes the URL handle (lowercase, digits, hyphens). Suggestion: { "name": "Engineering", "slug": "engineering" }.',
  schema: FirstSpaceSchema,
  shouldRun: async ({ orgId }) => !(await orgHasAnySpace(orgId)),
  apply: async (value, { orgId }) => {
    const ctx = getCurrentContext();
    await ctx.db.insert(schema.kbSpaces).values({
      orgId,
      name: value.name,
      slug: value.slug,
    });
  },
});

const welcomeDoc = defineStep({
  id: 'welcome_doc',
  prompt:
    'Want to seed a starter "How we work" document in your first space? Pass `{ "create": true }` to accept the default, or `{ "create": false }` to skip. You may also pass a custom `title` and `body`.',
  schema: WelcomeDocSchema,
  shouldRun: async ({ orgId, answers }) => {
    if (answers.welcome_doc !== undefined) return false;
    return (await orgHasAnySpace(orgId)) && !(await orgHasAnyDocument(orgId));
  },
  apply: async (value, { orgId }) => {
    if (!value.create) return;
    const ctx = getCurrentContext();
    const space = await firstSpaceForOrg(orgId);
    if (!space) return;
    const title = value.title ?? 'How we work';
    const body =
      value.body ??
      [
        '# How we work',
        '',
        'A short orientation doc for your AI agents:',
        '',
        '- What does this team build?',
        '- What does "done" look like for our most common requests?',
        '- Where do customers hit the most friction today?',
        '',
        'Replace this with your real content. Agents will pull it into KB search and customer replies.',
      ].join('\n');
    const actor = ctx.actor!;
    const tag = actor.type === 'user' ? 'user' : 'agent';
    await ctx.db.insert(schema.kbDocuments).values({
      orgId,
      spaceId: space.id,
      title,
      body,
      public: false,
      version: 1,
      contentHash: 'bootstrap',
      tags: [],
      createdByType: tag,
      createdById: actor.id,
      updatedByType: tag,
      updatedById: actor.id,
    });
  },
});

async function orgHasAnySpace(orgId: string): Promise<boolean> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.kbSpaces.id })
    .from(schema.kbSpaces)
    .where(eq(schema.kbSpaces.orgId, orgId))
    .limit(1);
  return rows.length > 0;
}

async function orgHasAnyDocument(orgId: string): Promise<boolean> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.kbDocuments.id })
    .from(schema.kbDocuments)
    .where(eq(schema.kbDocuments.orgId, orgId))
    .limit(1);
  return rows.length > 0;
}

async function firstSpaceForOrg(orgId: string): Promise<{ id: string } | null> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.kbSpaces.id })
    .from(schema.kbSpaces)
    .where(eq(schema.kbSpaces.orgId, orgId))
    .orderBy(schema.kbSpaces.createdAt)
    .limit(1);
  return rows[0] ?? null;
}

export const kbBootstrap = new BootstrapRunner('kb', [firstSpace, welcomeDoc]);
