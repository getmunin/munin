import { randomUUID } from 'node:crypto';
import {
  runSkillPass,
  type CuratorJob,
  type CuratorJobPendingEvent,
  type MuninRestClient,
  type SkillPassResult,
} from '@getmunin/agent-runtime';
import type { SidecarConfig } from './config.js';

export interface CuratorLoopDeps {
  config: SidecarConfig;
  rest: MuninRestClient;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  runSkillPassImpl?: typeof runSkillPass;
}

export interface CuratorLoop {
  onCuratorJobPending(event: CuratorJobPendingEvent): void;
  onConnected(): void;
  stop(): Promise<void>;
}

const LEASE_SECONDS = 600;
const MAX_SCHEDULED_DELAY_MS = 24 * 60 * 60 * 1000;

export function startCurators(deps: CuratorLoopDeps): CuratorLoop {
  const { config, rest } = deps;
  const log = deps.logger ?? {
    info: (m) => console.log(`[curators] ${m}`),
    warn: (m) => console.warn(`[curators] ${m}`),
    error: (m) => console.error(`[curators] ${m}`),
  };
  const run = deps.runSkillPassImpl ?? runSkillPass;
  const holder = `agent-sidecar-${randomUUID()}`;
  const timers: NodeJS.Timeout[] = [];
  const scheduledByJob = new Map<string, NodeJS.Timeout>();
  const inFlight: Set<Promise<unknown>> = new Set();
  let stopped = false;
  let pollPending: Promise<void> | null = null;

  function track<T>(promise: Promise<T>): Promise<T> {
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
    return promise;
  }

  async function executeOne(job: CuratorJob): Promise<void> {
    log.info(`running ${job.skillUri} for job ${job.id} (attempt ${job.attempts}/${job.maxAttempts})`);
    let result: SkillPassResult;
    try {
      result = await run({
        baseUrl: config.muninBaseUrl,
        adminApiKey: config.muninAdminApiKey,
        providerBaseUrl: config.providerBaseUrl,
        providerApiKey: config.providerApiKey,
        model: config.model,
        skillUri: job.skillUri,
        userPrompt: job.userPrompt,
        maxToolIterations: 24,
        maxHistoryChars: config.maxHistoryChars,
        clientName: `munin-sidecar-job-${job.id.slice(-6)}`,
        allowedToolPrefixes: toolPrefixesFor(job.skillUri),
        logger: log,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`job ${job.id} threw: ${message}`);
      await rest.failCuratorJob(job.id, { error: message }).catch((failErr) => {
        log.error(`job ${job.id} fail-report failed: ${describe(failErr)}`);
      });
      return;
    }

    if (result.ok) {
      log.info(
        `job ${job.id} done (tools=${result.toolCalls}, tokens=${result.totalTokens})`,
      );
      await rest
        .ackCuratorJob(job.id, {
          replyText: result.replyText,
          toolCalls: result.toolCalls,
          totalTokens: result.totalTokens,
        })
        .catch((err) => log.error(`job ${job.id} ack failed: ${describe(err)}`));
      return;
    }

    const retryable = result.skipped !== 'skill_missing' && result.skipped !== 'no_admin_key' &&
      result.skipped !== 'no_provider_key';
    log.warn(
      `job ${job.id} skipped: ${result.skipped}${result.error ? ` (${result.error})` : ''}`,
    );
    await rest
      .failCuratorJob(job.id, {
        error: `${result.skipped}${result.error ? `: ${result.error}` : ''}`,
        retryable,
      })
      .catch((err) => log.error(`job ${job.id} fail-report failed: ${describe(err)}`));
  }

  async function pollOnce(): Promise<void> {
    if (stopped) return;
    if (config.curatorsDisabled) return;
    let jobs: CuratorJob[];
    try {
      jobs = await rest.claimCuratorJobs({ holder, limit: 1, leaseSeconds: LEASE_SECONDS });
    } catch (err) {
      log.warn(`claim failed: ${describe(err)}`);
      return;
    }
    for (const job of jobs) {
      if (stopped) break;
      await executeOne(job);
    }
  }

  function triggerPoll(): void {
    if (stopped || config.curatorsDisabled) return;
    if (pollPending) return;
    pollPending = track(
      pollOnce().finally(() => {
        pollPending = null;
      }),
    );
  }

  function onCuratorJobPending(event: CuratorJobPendingEvent): void {
    if (config.curatorsDisabled) return;
    const dueAt = new Date(event.nextAttemptAt).getTime();
    const delay = Number.isFinite(dueAt) ? dueAt - Date.now() : 0;
    if (delay <= 1000) {
      log.info(`curator_job.pending ${event.jobId} (${event.skillUri}) — waking worker`);
      triggerPoll();
      return;
    }
    const existing = scheduledByJob.get(event.jobId);
    if (existing) clearTimeout(existing);
    const clamped = Math.min(delay, MAX_SCHEDULED_DELAY_MS);
    log.info(
      `curator_job.pending ${event.jobId} scheduled in ${Math.round(clamped / 1000)}s`,
    );
    const timer = setTimeout(() => {
      scheduledByJob.delete(event.jobId);
      triggerPoll();
    }, clamped);
    scheduledByJob.set(event.jobId, timer);
  }

  function onConnected(): void {
    if (config.curatorsDisabled) return;
    log.info('realtime connected — draining queue');
    triggerPoll();
  }

  if (!config.curatorsDisabled) {
    triggerPoll();
  }

  return {
    onCuratorJobPending,
    onConnected,
    async stop(): Promise<void> {
      stopped = true;
      for (const t of timers) clearInterval(t);
      timers.length = 0;
      for (const t of scheduledByJob.values()) clearTimeout(t);
      scheduledByJob.clear();
      await Promise.allSettled([...inFlight]);
    },
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toolPrefixesFor(skillUri: string): string[] | undefined {
  if (skillUri === 'skill://kb/curation') return ['conv_', 'kb_'];
  if (skillUri === 'skill://crm/hygiene') return ['conv_', 'crm_'];
  if (skillUri === 'skill://crm/contact-extract') return ['conv_', 'crm_'];
  if (skillUri === 'skill://cms/stale-content-review') return ['cms_'];
  return undefined;
}
