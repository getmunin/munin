import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CuratorSchedulerService, sweepSpreadSeconds } from './curator-scheduler.service.ts';
import { jitteredBackoffMs } from './curator-jobs.service.ts';

describe('CuratorSchedulerService.onModuleInit', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.MUNIN_CURATOR_SCHEDULER_DISABLED;
    delete process.env.MUNIN_CURATOR_KB_SWEEP_CRON;
    delete process.env.MUNIN_CURATOR_CRM_HYGIENE_CRON;
    delete process.env.MUNIN_CURATOR_CMS_STALE_CRON;
  });
  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  function build(): { svc: CuratorSchedulerService; registry: SchedulerRegistry } {
    const registry = new SchedulerRegistry();
    const db = {} as never;
    const jobs = {} as never;
    const svc = new CuratorSchedulerService(db, jobs, registry);
    return { svc, registry };
  }

  it('registers the five default cron jobs when not disabled', () => {
    const { svc, registry } = build();
    svc.onModuleInit();
    const jobs = registry.getCronJobs();
    expect([...jobs.keys()].sort()).toEqual([
      'curator-cms-stale',
      'curator-crm-hygiene',
      'curator-kb-sweep',
      'curator-outreach-draft-followup',
      'curator-outreach-first-touch',
    ]);
  });

  it('skips a sweep when its env var is set to "off"', () => {
    process.env.MUNIN_CURATOR_CMS_STALE_CRON = 'off';
    const { svc, registry } = build();
    svc.onModuleInit();
    const names = [...registry.getCronJobs().keys()];
    expect(names).toContain('curator-kb-sweep');
    expect(names).toContain('curator-crm-hygiene');
    expect(names).not.toContain('curator-cms-stale');
  });

  it('honors a custom cron expression from env', () => {
    process.env.MUNIN_CURATOR_KB_SWEEP_CRON = '*/5 * * * *';
    const { svc, registry } = build();
    svc.onModuleInit();
    const job = registry.getCronJob('curator-kb-sweep');
    expect(job).toBeDefined();
    expect(String(job.cronTime.source)).toBe('*/5 * * * *');
  });

  it('registers nothing when MUNIN_CURATOR_SCHEDULER_DISABLED=1', () => {
    process.env.MUNIN_CURATOR_SCHEDULER_DISABLED = '1';
    const { svc, registry } = build();
    svc.onModuleInit();
    expect([...registry.getCronJobs().keys()]).toHaveLength(0);
  });

  it('registers nothing when NODE_ENV=test (default in vitest)', () => {
    process.env.NODE_ENV = 'test';
    const { svc, registry } = build();
    svc.onModuleInit();
    expect([...registry.getCronJobs().keys()]).toHaveLength(0);
  });
});

describe('sweepSpreadSeconds', () => {
  it('does not delay a single-org deployment', () => {
    expect(sweepSpreadSeconds(0)).toBe(0);
    expect(sweepSpreadSeconds(1)).toBe(0);
  });

  it('widens the window as the fleet grows', () => {
    expect(sweepSpreadSeconds(13)).toBe(720);
    expect(sweepSpreadSeconds(100)).toBe(5_940);
  });

  it('caps the window at four hours', () => {
    expect(sweepSpreadSeconds(10_000)).toBe(4 * 60 * 60);
  });
});

describe('jitteredBackoffMs', () => {
  it('grows exponentially with attempts', () => {
    const none = (): number => 0;
    expect(jitteredBackoffMs(1, none)).toBe(30_000);
    expect(jitteredBackoffMs(2, none)).toBe(60_000);
    expect(jitteredBackoffMs(3, none)).toBe(120_000);
  });

  it('spreads jobs that failed together across a 1-2x window', () => {
    expect(jitteredBackoffMs(1, () => 0)).toBe(30_000);
    expect(jitteredBackoffMs(1, () => 1)).toBe(60_000);
  });

  it('never returns less than the base delay', () => {
    expect(jitteredBackoffMs(0, () => 0)).toBe(30_000);
  });
});
