import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Db } from '@getmunin/db';
import {
  createConversationHandler,
  createMuninRestClient,
  createPromptResolver,
  createRealtimeClient,
  defaultPromptsDir,
  openMcpClient,
  runSkillPass,
  type ConversationHandler,
  type CuratorJob,
  type CuratorJobPendingEvent,
  type HandlerConfig,
  type KbDocumentChangedEvent,
  type MessageReceivedEvent,
  type MuninRestClient,
  type PromptResolver,
  type SkillPassResult,
} from '@getmunin/agent-runtime';
import { AGENT_CONFIG_REPOSITORY, AGENT_HOST_DB } from './injection-tokens.js';
import type { AgentConfigRepository, AgentConfigRow } from './config.repository.js';
import { runWithServiceContext } from './service-context.js';
import { ReplicaLockManager } from './replica-lock.js';

const RECONCILE_INTERVAL_MS = 30_000;
const CURATOR_LEASE_SECONDS = 600;
const CURATOR_MAX_SCHEDULED_DELAY_MS = 24 * 60 * 60 * 1000;

export interface AgentHostRunnerOptions {
  baseUrl?: string;
  fallbackAdminApiKey?: string;
  promptsDir?: string;
  databaseUrl?: string;
}

interface PerConfigRunner {
  realtime: { stop: () => Promise<void> };
  handler: ConversationHandler;
  prompts: PromptResolver;
  adminMcp: { close: () => Promise<void> };
  curatorWorker: CuratorWorker;
}

interface CuratorWorker {
  onPending(event: CuratorJobPendingEvent): void;
  onConnected(): void;
  stop(): Promise<void>;
}

@Injectable()
export class AgentHostRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AgentHostRunner.name);
  private readonly runners = new Map<string, PerConfigRunner>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly baseUrl: string;
  private readonly fallbackAdminApiKey: string | undefined;
  private readonly promptsDir: string;
  private readonly holderId: string;
  private readonly lockManager: ReplicaLockManager | null;

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY) private readonly repo: AgentConfigRepository,
    @Inject(AGENT_HOST_DB) private readonly db: Db,
    @Optional() @Inject('AGENT_HOST_RUNNER_OPTIONS') options?: AgentHostRunnerOptions,
  ) {
    this.baseUrl = options?.baseUrl ?? process.env.MUNIN_BASE_URL ?? 'http://localhost:3001';
    this.fallbackAdminApiKey = options?.fallbackAdminApiKey ?? process.env.MUNIN_ADMIN_API_KEY;
    this.promptsDir = options?.promptsDir ?? defaultPromptsDir();
    this.holderId =
      process.env.MUNIN_AGENT_HOLDER_ID ??
      `agent-host-${hostname()}-${randomUUID().slice(0, 8)}`;
    const databaseUrl = options?.databaseUrl ?? process.env.DATABASE_URL;
    this.lockManager = databaseUrl ? new ReplicaLockManager(databaseUrl) : null;
    if (!this.lockManager) {
      this.logger.warn(
        'no DATABASE_URL — chat sub-loop runs unconditionally; safe only on a single replica',
      );
    }
  }

  onApplicationBootstrap(): void {
    if (process.env.MUNIN_BUILTIN_AGENT === '0') {
      this.logger.log('bundled agent runner disabled via MUNIN_BUILTIN_AGENT=0');
      return;
    }
    void this.reconcile();
    this.reconcileTimer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    await Promise.all(
      [...this.runners.values()].map(async (r) => {
        await r.realtime.stop();
        await r.handler.flush();
        await r.curatorWorker.stop();
        await r.adminMcp.close().catch((err: unknown) => {
          this.logger.warn(`adminMcp.close() on shutdown failed: ${describe(err)}`);
        });
      }),
    );
    this.runners.clear();
    if (this.lockManager) await this.lockManager.stop();
  }

  private async reconcile(): Promise<void> {
    if (this.stopped) return;
    let enabledIds: string[];
    try {
      enabledIds = await runWithServiceContext(this.db, '_reconcile', () =>
        this.repo.listEnabledIds(),
      );
    } catch (err) {
      this.logger.warn(`reconcile: failed to list configs: ${describe(err)}`);
      return;
    }

    const desired = new Set(enabledIds);

    for (const [id, runner] of this.runners) {
      if (!desired.has(id)) {
        this.logger.log(`stopping runner for ${id}`);
        await runner.realtime.stop();
        await runner.handler.flush();
        await runner.curatorWorker.stop();
        await runner.adminMcp.close().catch((err: unknown) => {
          this.logger.warn(`${id}: adminMcp.close() on stop failed: ${describe(err)}`);
        });
        this.runners.delete(id);
        if (this.lockManager) await this.lockManager.release(id);
      }
    }

    for (const id of enabledIds) {
      if (this.runners.has(id)) continue;
      try {
        const runner = await this.spawnRunner(id);
        if (runner) {
          this.runners.set(id, runner);
          this.logger.log(`started runner for ${id}`);
        }
      } catch (err) {
        this.logger.error(`failed to start runner for ${id}: ${describe(err)}`);
      }
    }

    if (this.lockManager) {
      for (const id of enabledIds) {
        const got = await this.lockManager.tryAcquire(id);
        if (got && !this.lockManager.holds(id)) {
          this.logger.log(`acquired chat lock for ${id}`);
        }
      }
    }
  }

  private async spawnRunner(id: string): Promise<PerConfigRunner | null> {
    const config = await runWithServiceContext(this.db, id, () => this.repo.read(id));
    const adminApiKey =
      (await runWithServiceContext(this.db, id, () =>
        this.repo.readDecryptedAdminKey(id),
      )) ?? this.fallbackAdminApiKey;
    const providerApiKey = await runWithServiceContext(this.db, id, () =>
      this.repo.readDecryptedProviderKey(id),
    );

    if (!adminApiKey) {
      this.logger.warn(`${id}: enabled but no admin API key (configure or set MUNIN_ADMIN_API_KEY)`);
      return null;
    }
    if (!providerApiKey) {
      this.logger.warn(`${id}: enabled but no LLM provider API key`);
      return null;
    }

    const rest = createMuninRestClient({ baseUrl: this.baseUrl, adminApiKey });

    const adminMcp = await openMcpClient({
      baseUrl: this.baseUrl,
      bearerToken: adminApiKey,
      clientName: `agent-host-${id}`,
    });

    const prompts = await createPromptResolver({
      promptsDir: this.promptsDir,
      mcp: adminMcp,
      logger: this.scopedLogger(id, 'prompts'),
    });

    const handlerConfig: HandlerConfig = {
      providerBaseUrl: config.providerBaseUrl,
      providerApiKey,
      model: config.chatModel,
      maxToolIterations: config.maxToolIterations,
      maxHistoryChars: config.maxHistoryChars,
      debounceMs: config.debounceMs,
    };

    const handler = createConversationHandler({
      config: handlerConfig,
      rest,
      prompts,
      openMcp: ({ delegatedToken }) =>
        openMcpClient({ baseUrl: this.baseUrl, bearerToken: delegatedToken }),
      holderId: this.holderId,
      logger: this.scopedLogger(id, 'chat'),
    });

    const curatorWorker = this.buildCuratorWorker({ id, config, providerApiKey, rest });

    const realtime = createRealtimeClient({
      baseUrl: this.baseUrl,
      adminApiKey,
      onMessageReceived: (event: MessageReceivedEvent) => {
        if (this.lockManager && !this.lockManager.holds(id)) return;
        handler.handle({ conversationId: event.conversationId, authorType: event.authorType });
      },
      onCuratorJobPending: (event) => curatorWorker.onPending(event),
      onConnected: () => curatorWorker.onConnected(),
      onKbDocumentChanged: (event: KbDocumentChangedEvent) => {
        if (event.type === 'deleted') return;
        if (!event.slug || !prompts.isPromptDocument(event.slug)) return;
        void prompts.refresh(event.slug);
      },
      logger: this.scopedLogger(id, 'realtime'),
    });
    realtime.start();

    return { realtime, handler, prompts, adminMcp, curatorWorker };
  }

  private buildCuratorWorker(opts: {
    id: string;
    config: AgentConfigRow;
    providerApiKey: string;
    rest: MuninRestClient;
  }): CuratorWorker {
    const log = this.scopedLogger(opts.id, 'curator');
    const inFlight = new Set<Promise<unknown>>();
    const scheduledByJob = new Map<string, NodeJS.Timeout>();
    let pollPending: Promise<void> | null = null;
    let stopped = false;

    const track = <T,>(p: Promise<T>): Promise<T> => {
      inFlight.add(p);
      void p.finally(() => inFlight.delete(p));
      return p;
    };

    const curatorModel = opts.config.curatorModel ?? opts.config.chatModel;

    const executeOne = async (job: CuratorJob): Promise<void> => {
      log.info(`running ${job.skillUri} for ${job.id} (attempt ${job.attempts}/${job.maxAttempts})`);
      let result: SkillPassResult;
      try {
        result = await runSkillPass({
          baseUrl: this.baseUrl,
          adminApiKey: (await runWithServiceContext(this.db, opts.id, () =>
            this.repo.readDecryptedAdminKey(opts.id),
          )) ?? this.fallbackAdminApiKey ?? '',
          providerBaseUrl: opts.config.providerBaseUrl,
          providerApiKey: opts.providerApiKey,
          model: curatorModel,
          skillUri: job.skillUri,
          userPrompt: job.userPrompt,
          maxToolIterations: 24,
          maxHistoryChars: opts.config.maxHistoryChars,
          clientName: `agent-host-curator-${job.id.slice(-6)}`,
          allowedToolPrefixes: toolPrefixesFor(job.skillUri),
          logger: log,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await opts.rest
          .failCuratorJob(job.id, { error: message })
          .catch((e) => log.error(`fail-report failed: ${describe(e)}`));
        return;
      }

      if (result.ok) {
        log.info(`${job.id} done (tools=${result.toolCalls}, tokens=${result.totalTokens})`);
        await opts.rest
          .ackCuratorJob(job.id, {
            replyText: result.replyText,
            toolCalls: result.toolCalls,
            totalTokens: result.totalTokens,
          })
          .catch((e) => log.error(`ack failed: ${describe(e)}`));
        return;
      }

      const retryable =
        result.skipped !== 'skill_missing' &&
        result.skipped !== 'no_admin_key' &&
        result.skipped !== 'no_provider_key';
      log.warn(`${job.id} skipped: ${result.skipped}${result.error ? ` (${result.error})` : ''}`);
      await opts.rest
        .failCuratorJob(job.id, {
          error: `${result.skipped}${result.error ? `: ${result.error}` : ''}`,
          retryable,
        })
        .catch((e) => log.error(`fail-report failed: ${describe(e)}`));
    };

    const pollOnce = async (): Promise<void> => {
      if (stopped) return;
      let jobs: CuratorJob[];
      try {
        jobs = await opts.rest.claimCuratorJobs({
          holder: this.holderId,
          limit: 1,
          leaseSeconds: CURATOR_LEASE_SECONDS,
        });
      } catch (err) {
        log.warn(`claim failed: ${describe(err)}`);
        return;
      }
      for (const job of jobs) {
        if (stopped) break;
        await executeOne(job);
      }
    };

    const triggerPoll = (): void => {
      if (stopped) return;
      if (pollPending) return;
      pollPending = track(
        pollOnce().finally(() => {
          pollPending = null;
        }),
      );
    };

    return {
      onPending(event) {
        if (stopped) return;
        const dueAt = new Date(event.nextAttemptAt).getTime();
        const delay = Number.isFinite(dueAt) ? dueAt - Date.now() : 0;
        if (delay <= 1000) {
          triggerPoll();
          return;
        }
        const existing = scheduledByJob.get(event.jobId);
        if (existing) clearTimeout(existing);
        const clamped = Math.min(delay, CURATOR_MAX_SCHEDULED_DELAY_MS);
        const timer = setTimeout(() => {
          scheduledByJob.delete(event.jobId);
          triggerPoll();
        }, clamped);
        scheduledByJob.set(event.jobId, timer);
      },
      onConnected() {
        if (stopped) return;
        log.info('realtime connected — draining queue');
        triggerPoll();
      },
      async stop() {
        stopped = true;
        for (const t of scheduledByJob.values()) clearTimeout(t);
        scheduledByJob.clear();
        await Promise.allSettled([...inFlight]);
      },
    };
  }

  private scopedLogger(id: string, sub: string): {
    info: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  } {
    return {
      info: (m) => this.logger.log(`${id} ${sub}: ${m}`),
      warn: (m) => this.logger.warn(`${id} ${sub}: ${m}`),
      error: (m) => this.logger.error(`${id} ${sub}: ${m}`),
    };
  }
}

function toolPrefixesFor(skillUri: string): string[] | undefined {
  if (skillUri === 'skill://kb/curation') return ['conv_', 'kb_'];
  if (skillUri === 'skill://crm/hygiene') return ['conv_', 'crm_'];
  if (skillUri === 'skill://crm/contact-extract') return ['conv_', 'crm_'];
  if (skillUri === 'skill://outreach/draft-initial') return ['conv_', 'kb_', 'crm_', 'outreach_'];
  if (skillUri === 'skill://outreach/draft-reply') return ['conv_', 'kb_', 'crm_', 'outreach_'];
  if (skillUri === 'skill://cms/stale-content-review') return ['cms_'];
  return undefined;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
