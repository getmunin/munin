import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConvSchedulerService } from './conv-scheduler.service.ts';

describe('ConvSchedulerService.onModuleInit', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.MUNIN_CONV_AUTO_CLOSE_DISABLED;
    delete process.env.MUNIN_CONV_AUTO_CLOSE_CRON;
  });
  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  function build(): { svc: ConvSchedulerService; registry: SchedulerRegistry } {
    const registry = new SchedulerRegistry();
    const db = {} as never;
    const conv = {} as never;
    const svc = new ConvSchedulerService(db, conv, registry);
    return { svc, registry };
  }

  it('registers the auto-close cron job when not disabled', () => {
    const { svc, registry } = build();
    svc.onModuleInit();
    expect([...registry.getCronJobs().keys()]).toEqual(['conv-auto-close']);
  });

  it('honors a custom cron expression from env', () => {
    process.env.MUNIN_CONV_AUTO_CLOSE_CRON = '*/15 * * * *';
    const { svc, registry } = build();
    svc.onModuleInit();
    const job = registry.getCronJob('conv-auto-close');
    expect(job).toBeDefined();
    expect(String(job.cronTime.source)).toBe('*/15 * * * *');
  });

  it('registers nothing when the cron env var is "off"', () => {
    process.env.MUNIN_CONV_AUTO_CLOSE_CRON = 'off';
    const { svc, registry } = build();
    svc.onModuleInit();
    expect([...registry.getCronJobs().keys()]).toHaveLength(0);
  });

  it('registers nothing when MUNIN_CONV_AUTO_CLOSE_DISABLED=1', () => {
    process.env.MUNIN_CONV_AUTO_CLOSE_DISABLED = '1';
    const { svc, registry } = build();
    svc.onModuleInit();
    expect([...registry.getCronJobs().keys()]).toHaveLength(0);
  });

  it('registers nothing when NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    const { svc, registry } = build();
    svc.onModuleInit();
    expect([...registry.getCronJobs().keys()]).toHaveLength(0);
  });
});
