import { schema } from '@munin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@munin/core';
import { BootstrapRunner, defineStep } from '@munin/bootstrap';
import { z } from 'zod';

const FirstChannelSchema = z.object({
  /** Channel kind. v0.4 ships chat + email handlers; voice/sms are stubs. */
  type: z.enum(['chat', 'email', 'voice', 'sms']).default('chat'),
  name: z.string().min(1).max(120).default('Web chat'),
});

const SeedTopicsSchema = z.object({
  /** Pass `false` to skip seeding starter topics. */
  seed: z.boolean().default(true),
  /** Override the default topic names. */
  topics: z
    .array(z.object({ name: z.string().min(1).max(120), slug: z.string().min(1).max(64) }))
    .optional(),
});

const DEFAULT_TOPICS: { name: string; slug: string }[] = [
  { name: 'Billing', slug: 'billing' },
  { name: 'Support', slug: 'support' },
  { name: 'Bug', slug: 'bug' },
];

const firstChannel = defineStep({
  id: 'first_channel',
  prompt:
    'Pick the type and display name for your first conversations channel. The default is a "chat" channel — fine for AI-driven self-service. Suggestion: { "type": "chat", "name": "Web chat" }.',
  schema: FirstChannelSchema,
  shouldRun: async ({ orgId }) => !(await orgHasAnyChannel(orgId)),
  apply: async (value, { orgId }) => {
    const ctx = getCurrentContext();
    await ctx.db.insert(schema.convChannels).values({
      orgId,
      type: value.type,
      name: value.name,
      active: true,
    });
  },
});

const seedTopics = defineStep({
  id: 'seed_topics',
  prompt:
    'Seed starter conversation topics? Pass `{ "seed": true }` to accept (Billing, Support, Bug), or `{ "seed": false }` to skip. You can override with a custom `topics` array.',
  schema: SeedTopicsSchema,
  shouldRun: async ({ orgId }) => !(await orgHasAnyTopic(orgId)),
  apply: async (value, { orgId }) => {
    if (!value.seed) return;
    const ctx = getCurrentContext();
    const topics = value.topics?.length ? value.topics : DEFAULT_TOPICS;
    for (const t of topics) {
      await ctx.db
        .insert(schema.convTopics)
        .values({ orgId, name: t.name, slug: t.slug })
        .onConflictDoNothing();
    }
  },
});

async function orgHasAnyChannel(orgId: string): Promise<boolean> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.convChannels.id })
    .from(schema.convChannels)
    .where(eq(schema.convChannels.orgId, orgId))
    .limit(1);
  return rows.length > 0;
}

async function orgHasAnyTopic(orgId: string): Promise<boolean> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.convTopics.id })
    .from(schema.convTopics)
    .where(eq(schema.convTopics.orgId, orgId))
    .limit(1);
  return rows.length > 0;
}

export const convBootstrap = new BootstrapRunner('conv', [firstChannel, seedTopics]);
