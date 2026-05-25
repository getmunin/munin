import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { schema, type Db } from '@getmunin/db';
import { sql } from 'drizzle-orm';
import { ActorIdentity, RequestContextStore, type RequestContext } from '@getmunin/core';
import { randomUUID } from 'node:crypto';
import { DB } from '../../common/db/db.module.js';
import { withSchedulerLock } from '../../common/scheduler-lock/index.js';
import { CuratorJobsService } from './curator-jobs.service.js';

const KB_SWEEP_PROMPT =
  'Run a KB curation pass over the last 7 days of resolved-handover conversations. Follow the procedure in the skill exactly. Skip duplicates and one-off answers. File each candidate via kb_propose_curation_candidate. Stop when there are no more candidates to file.';
const CRM_HYGIENE_PROMPT =
  'Run a CRM hygiene pass. Follow the skill. First fetch dismissed pairs via crm_list_merge_proposals so you do not refile rejected pairs. Then list contacts, build suspect pairs, judge each, and file high-confidence pairs as structured proposals via crm_propose_merge_candidate. Stop when there are no more new pairs to propose.';
const CMS_STALE_PROMPT =
  'Run a CMS stale-content review pass. Follow the skill. Walk each collection, judge per-collection velocity, find stale drafts, find unrefreshed published entries, find orphaned assets. Produce a structured action report grouped by recommended action. Do not execute any mutating tool — propose only.';
const OUTREACH_DRAFT_INITIAL_PROMPT =
  'Run an outreach draft-initial pass. Follow skill://outreach/draft-initial-email exactly. List enabled campaigns, materialise each segment via crm_list_contacts_in_segment, dedupe via outreach_list_proposals, ground each draft in kb_search results, and file every new draft via outreach_propose_initial. Do NOT approve or send anything — drafts go to the operator review queue.';

interface SweepDef {
  name: string;
  envCron: string | undefined;
  defaultCron: string;
  jobUri: string;
  userPrompt: string;
  dedupeKey: string;
}

@Injectable()
export class CuratorSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CuratorSchedulerService.name);
  private readonly disabled =
    process.env.MUNIN_CURATOR_SCHEDULER_DISABLED === '1' ||
    process.env.NODE_ENV === 'test';

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobs: CuratorJobsService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.disabled) {
      this.logger.log('curator scheduler disabled');
      return;
    }

    const sweeps: SweepDef[] = [
      {
        name: 'curator-kb-sweep',
        envCron: process.env.MUNIN_CURATOR_KB_SWEEP_CRON,
        defaultCron: CronExpression.EVERY_WEEK,
        jobUri: 'skill://kb/review-content',
        userPrompt: KB_SWEEP_PROMPT,
        dedupeKey: 'kb-sweep:scheduled',
      },
      {
        name: 'curator-crm-hygiene',
        envCron: process.env.MUNIN_CURATOR_CRM_HYGIENE_CRON,
        defaultCron: CronExpression.EVERY_WEEK,
        jobUri: 'skill://crm/clean-contact-data',
        userPrompt: CRM_HYGIENE_PROMPT,
        dedupeKey: 'crm-hygiene:scheduled',
      },
      {
        name: 'curator-cms-stale',
        envCron: process.env.MUNIN_CURATOR_CMS_STALE_CRON,
        defaultCron: CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT,
        jobUri: 'skill://cms/review-stale-entries',
        userPrompt: CMS_STALE_PROMPT,
        dedupeKey: 'cms-stale:scheduled',
      },
      {
        name: 'curator-outreach-draft-initial',
        envCron: process.env.MUNIN_CURATOR_OUTREACH_INITIAL_CRON,
        defaultCron: CronExpression.EVERY_WEEK,
        jobUri: 'skill://outreach/draft-initial-email',
        userPrompt: OUTREACH_DRAFT_INITIAL_PROMPT,
        dedupeKey: 'outreach-draft-initial:scheduled',
      },
    ];

    for (const sweep of sweeps) {
      const cron = (sweep.envCron && sweep.envCron.trim()) || sweep.defaultCron;
      if (cron === 'off' || cron === '0') {
        this.logger.log(`${sweep.name} disabled by env`);
        continue;
      }
      const job = new CronJob(cron, () => {
        void withSchedulerLock(this.db, `curator-scheduler:${sweep.name}`, () =>
          this.runSweep(sweep),
        );
      });
      this.registry.addCronJob(sweep.name, job);
      job.start();
      this.logger.log(`${sweep.name} scheduled with "${cron}"`);
    }
  }

  private async runSweep(sweep: SweepDef): Promise<void> {
    const orgs = await this.db
      .select({ id: schema.orgs.id })
      .from(schema.orgs);
    if (orgs.length === 0) return;

    for (const org of orgs) {
      try {
        await this.enqueueAsOrg(org.id, sweep);
      } catch (err) {
        this.logger.warn(
          `${sweep.name} enqueue failed for org ${org.id}: ${describe(err)}`,
        );
      }
    }
  }

  private async enqueueAsOrg(orgId: string, sweep: SweepDef): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'off', true)`);
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
      await tx.execute(sql`SELECT set_config('app.end_user_id', '', true)`);
      const actor = new ActorIdentity('admin_agent', 'curator-scheduler', orgId, ['*'], ['admin']);
      const ctx: RequestContext = { db: tx, actor, correlationId: randomUUID() };
      await RequestContextStore.run(ctx, async () => {
        const result = await this.jobs.enqueue({
          jobUri: sweep.jobUri,
          userPrompt: sweep.userPrompt,
          sourceEventType: `scheduler.${sweep.name}`,
          dedupeKey: sweep.dedupeKey,
        });
        if (result.alreadyPending) {
          this.logger.log(
            `${sweep.name} already pending for org ${orgId} (job ${result.job.id})`,
          );
        } else {
          this.logger.log(
            `${sweep.name} enqueued for org ${orgId} (job ${result.job.id})`,
          );
        }
      });
    });
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
