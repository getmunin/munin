import { schema } from '@munin/db';
import { eq } from 'drizzle-orm';
import { getCurrentContext } from '@munin/core';
import { BootstrapRunner, defineStep } from '@munin/bootstrap';
import { z } from 'zod';

const FirstPipelineSchema = z.object({
  name: z.string().min(1).max(120).default('Sales'),
  slug: z.string().min(1).max(64).default('sales'),
  /** Override the default stages. The first stage must be open. */
  stages: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        winLoss: z.enum(['open', 'won', 'lost']).optional(),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
});

const DEFAULT_STAGES = [
  { name: 'Lead', winLoss: 'open' as const },
  { name: 'Qualified', winLoss: 'open' as const },
  { name: 'Proposal', winLoss: 'open' as const },
  { name: 'Won', winLoss: 'won' as const },
  { name: 'Lost', winLoss: 'lost' as const },
];

const firstPipeline = defineStep({
  id: 'first_pipeline',
  prompt:
    'Pick a name + slug for your first sales pipeline, and optionally override its stages. Suggested default: { "name": "Sales", "slug": "sales" } with stages Lead → Qualified → Proposal → Won/Lost.',
  schema: FirstPipelineSchema,
  shouldRun: async ({ orgId }) => !(await orgHasAnyPipeline(orgId)),
  apply: async (value, { orgId }) => {
    const ctx = getCurrentContext();
    const stages = value.stages?.length ? value.stages : DEFAULT_STAGES;
    const [pipeline] = await ctx.db
      .insert(schema.crmPipelines)
      .values({ orgId, name: value.name, slug: value.slug })
      .returning();
    await ctx.db.insert(schema.crmStages).values(
      stages.map((s, position) => ({
        orgId,
        pipelineId: pipeline!.id,
        name: s.name,
        position,
        winLoss: s.winLoss ?? 'open',
      })),
    );
  },
});

async function orgHasAnyPipeline(orgId: string): Promise<boolean> {
  const ctx = getCurrentContext();
  const rows = await ctx.db
    .select({ id: schema.crmPipelines.id })
    .from(schema.crmPipelines)
    .where(eq(schema.crmPipelines.orgId, orgId))
    .limit(1);
  return rows.length > 0;
}

export const crmBootstrap = new BootstrapRunner('crm', [firstPipeline]);
