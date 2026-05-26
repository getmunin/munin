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
  InProcessMuninRestClientFactoryService,
  McpRegistryService,
  McpSkillRegistryService,
  RealtimeEventBus,
  openAdminAgentMcpClient,
  openEndUserAgentMcpClient,
  type AgentMcpClient,
  type AgentConfigChangedBusEvent,
  type CuratorJobPendingBusEvent,
  type GreetRequestedBusEvent,
  type KbDocumentChangedBusEvent,
  type MessageReceivedBusEvent,
  type RealtimeBusSubscription,
} from '@getmunin/backend-core';
import {
  createConversationHandler,
  createPromptResolver,
  runSkillPass,
  type ConversationHandler,
  type CuratorJob,
  type HandlerConfig,
  type MuninRestClient,
  type PromptResolver,
  type SkillPassResult,
  type SkillReader,
} from '@getmunin/agent-runtime';
import {
  jobKindOf,
  tierFor,
  toolPrefixesFor,
  WEB_SCRAPE_SITE_TASK_URI,
} from '@getmunin/types';
import { AGENT_CONFIG_REPOSITORY, AGENT_HOST_DB } from './injection-tokens.js';
import type { AgentConfigRepository, AgentConfigRow } from './config.repository.js';
import { runWithServiceContext } from './service-context.js';
import { ReplicaLockManager } from './replica-lock.js';
import { runWebImportJob } from './web-import.handler.js';
import { AgentHealthService } from './agent-health.service.js';

interface TaskHandlerContext {
  job: CuratorJob;
  mcp: AgentMcpClient;
  providerBaseUrl: string;
  providerApiKey: string;
  model: string;
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

type TaskHandler = (ctx: TaskHandlerContext) => Promise<SkillPassResult>;

const TASK_HANDLERS: ReadonlyMap<string, TaskHandler> = new Map([
  [WEB_SCRAPE_SITE_TASK_URI, (ctx: TaskHandlerContext) => runWebImportJob(ctx)],
]);

const RECONCILE_INTERVAL_MS = 30_000;
const CURATOR_LEASE_SECONDS = 600;
const CURATOR_MAX_SCHEDULED_DELAY_MS = 24 * 60 * 60 * 1000;

export interface AgentHostRunnerOptions {
  databaseUrl?: string;
}

interface PerConfigRunner {
  realtime: RealtimeBusSubscription;
  handler: ConversationHandler;
  prompts: PromptResolver;
  adminMcp: AgentMcpClient;
  curatorWorker: CuratorWorker;
}

interface CuratorWorker {
  onPending(event: CuratorJobPendingBusEvent): void;
  onConnected(): void;
  stop(): Promise<void>;
}

@Injectable()
export class AgentHostRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AgentHostRunner.name);
  private readonly runners = new Map<string, PerConfigRunner>();
  private readonly failedSpawns = new Map<string, { error: string; loggedAt: number }>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly holderId: string;
  private readonly lockManager: ReplicaLockManager | null;

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY) private readonly repo: AgentConfigRepository,
    @Inject(AGENT_HOST_DB) private readonly db: Db,
    @Inject(McpRegistryService) private readonly mcpRegistry: McpRegistryService,
    @Inject(McpSkillRegistryService) private readonly mcpSkills: McpSkillRegistryService,
    @Inject(RealtimeEventBus) private readonly eventBus: RealtimeEventBus,
    @Inject(InProcessMuninRestClientFactoryService)
    private readonly restClientFactory: InProcessMuninRestClientFactoryService,
    @Inject(AgentHealthService) private readonly health: AgentHealthService,
    @Optional() @Inject('AGENT_HOST_RUNNER_OPTIONS') options?: AgentHostRunnerOptions,
  ) {
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
        r.realtime.unsubscribe();
        await r.handler.stop();
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
    let provisionedIds: string[];
    try {
      provisionedIds = await runWithServiceContext(this.db, '_reconcile', () =>
        this.repo.listProvisionedIds(),
      );
    } catch (err) {
      this.logger.warn(`reconcile: failed to list configs: ${describe(err)}`);
      return;
    }

    const desired = new Set(provisionedIds);

    for (const [id, runner] of this.runners) {
      if (!desired.has(id)) {
        this.logger.log(`stopping runner for ${id}`);
        runner.realtime.unsubscribe();
        await runner.handler.stop();
        await runner.curatorWorker.stop();
        await runner.adminMcp.close().catch((err: unknown) => {
          this.logger.warn(`${id}: adminMcp.close() on stop failed: ${describe(err)}`);
        });
        this.runners.delete(id);
        if (this.lockManager) await this.lockManager.release(id);
      }
    }

    for (const id of provisionedIds) {
      if (this.runners.has(id)) continue;
      try {
        const runner = await this.spawnRunner(id);
        if (runner) {
          this.runners.set(id, runner);
          this.failedSpawns.delete(id);
          this.logger.log(`started runner for ${id}`);
        }
      } catch (err) {
        this.recordSpawnFailure(id, describe(err));
      }
    }

    if (this.lockManager) {
      for (const id of provisionedIds) {
        const got = await this.lockManager.tryAcquire(id);
        if (got && !this.lockManager.holds(id)) {
          this.logger.log(`acquired chat lock for ${id}`);
        }
      }
    }
  }

  private readonly respawnInFlight = new Set<string>();
  private readonly respawnPending = new Set<string>();

  private async respawnRunner(id: string): Promise<void> {
    if (this.stopped) return;
    if (this.respawnInFlight.has(id)) {
      this.respawnPending.add(id);
      return;
    }
    this.respawnInFlight.add(id);
    try {
      const existing = this.runners.get(id);
      if (existing) {
        this.logger.log(`respawn: stopping runner for ${id}`);
        try {
          existing.realtime.unsubscribe();
          await existing.handler.stop();
          await existing.curatorWorker.stop();
          await existing.adminMcp.close();
        } catch (err) {
          this.logger.warn(`respawn: teardown failed for ${id}: ${describe(err)}`);
        }
        this.runners.delete(id);
      }
      try {
        const runner = await this.spawnRunner(id);
        if (runner) {
          this.runners.set(id, runner);
          this.failedSpawns.delete(id);
          this.logger.log(`respawn: started runner for ${id}`);
        }
      } catch (err) {
        this.recordSpawnFailure(id, describe(err));
      }
    } finally {
      this.respawnInFlight.delete(id);
      if (this.respawnPending.delete(id) && !this.stopped) {
        void this.respawnRunner(id);
      }
    }
  }

  private recordSpawnFailure(id: string, error: string): void {
    const now = Date.now();
    const RELOG_MS = 10 * 60 * 1000;
    const prev = this.failedSpawns.get(id);
    const sameError = prev?.error === error;
    const dueForRelog = !prev || !sameError || now - prev.loggedAt >= RELOG_MS;
    if (dueForRelog) {
      this.logger.error(`failed to start runner for ${id}: ${error}`);
      this.failedSpawns.set(id, { error, loggedAt: now });
    } else {
      this.logger.debug?.(`spawn for ${id} still failing: ${error}`);
    }
  }

  private async spawnRunner(id: string): Promise<PerConfigRunner | null> {
    const config = await runWithServiceContext(this.db, id, () => this.repo.read(id));
    const orgId = await runWithServiceContext(this.db, id, () => this.repo.resolveOrgId(id));
    const providerApiKey = await runWithServiceContext(this.db, id, () =>
      this.repo.readDecryptedProviderKey(id),
    );

    if (!providerApiKey) {
      this.logger.warn(`${id}: enabled but no LLM provider API key`);
      return null;
    }

    const rest = this.restClientFactory.forOrg(orgId);

    const adminMcp = openAdminAgentMcpClient({
      db: this.db,
      orgId,
      registry: this.mcpRegistry,
      skills: this.mcpSkills,
    });

    const prompts = await createPromptResolver({
      mcp: adminMcp,
      logger: this.scopedLogger(id, 'prompts'),
    });

    const handlerConfig: HandlerConfig = {
      providerBaseUrl: config.providerBaseUrl,
      providerApiKey,
      model: config.fastModel,
      maxToolIterations: config.maxToolIterations,
      maxHistoryChars: config.maxHistoryChars,
      debounceMs: config.debounceMs,
    };

    const curatorWorker = this.buildCuratorWorker({ id, orgId, config, providerApiKey, rest });

    const handlerRef: { current: ConversationHandler | null } = { current: null };
    const realtime = this.eventBus.subscribe(
      { orgId },
      {
        onMessageReceived: (event: MessageReceivedBusEvent) => {
          if (this.lockManager && !this.lockManager.holds(id)) return;
          handlerRef.current?.handle({
            conversationId: event.conversationId,
            authorType: event.authorType,
          });
        },
        onGreetRequested: (event: GreetRequestedBusEvent) => {
          if (this.lockManager && !this.lockManager.holds(id)) return;
          handlerRef.current?.greet({ conversationId: event.conversationId });
        },
        onCuratorJobPending: (event) => curatorWorker.onPending(event),
        onConnected: () => curatorWorker.onConnected(),
        onKbDocumentChanged: (event: KbDocumentChangedBusEvent) => {
          if (event.type === 'deleted') return;
          if (!event.slug || !prompts.isPromptDocument(event.slug)) return;
          void prompts.refresh(event.slug);
        },
        onAgentConfigChanged: (event: AgentConfigChangedBusEvent) => {
          if (event.configId !== id) return;
          setImmediate(() => void this.respawnRunner(id));
        },
      },
    );

    const handler = createConversationHandler({
      config: handlerConfig,
      rest,
      prompts,
      openMcp: ({ endUserId }) =>
        Promise.resolve(
          openEndUserAgentMcpClient({
            db: this.db,
            orgId,
            endUserId,
            registry: this.mcpRegistry,
            skills: this.mcpSkills,
          }),
        ),
      holderId: this.holderId,
      logger: this.scopedLogger(id, 'chat'),
      onTyping: (conversationId, isTyping) =>
        this.eventBus.publishConversationTyping(orgId, conversationId, isTyping),
      onProviderError: (code, message) => {
        void runWithServiceContext(this.db, id, () =>
          this.health.recordFailure(id, code, message),
        ).catch((err) =>
          this.scopedLogger(id, 'chat').warn(`recordFailure failed: ${describe(err)}`),
        );
      },
      onProviderSuccess: () => {
        void runWithServiceContext(this.db, id, () => this.health.recordSuccess(id)).catch(
          (err) => this.scopedLogger(id, 'chat').warn(`recordSuccess failed: ${describe(err)}`),
        );
      },
    });
    handlerRef.current = handler;

    return { realtime, handler, prompts, adminMcp, curatorWorker };
  }

  private buildCuratorWorker(opts: {
    id: string;
    orgId: string;
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

    const smartModel = opts.config.smartModel ?? opts.config.fastModel;
    const fastModel = opts.config.fastModel;

    const executeOne = async (job: CuratorJob): Promise<void> => {
      log.info(`running ${job.jobUri} for ${job.id} (attempt ${job.attempts}/${job.maxAttempts})`);
      let result: SkillPassResult;
      const jobMcp = openAdminAgentMcpClient({
        db: this.db,
        orgId: opts.orgId,
        registry: this.mcpRegistry,
        skills: this.mcpSkills,
      });
      const skills: SkillReader = {
        readSkill: async (uri: string) => {
          try {
            const res = await jobMcp.readResource(uri);
            return typeof res.text === 'string' ? res.text : null;
          } catch (err) {
            log.warn(`readSkill failed for ${uri}: ${describe(err)}`);
            return null;
          }
        },
      };
      try {
        const tier = tierFor(job.jobUri);
        const model = tier === 'fast' ? fastModel : smartModel;
        const ctx: TaskHandlerContext = {
          job,
          mcp: jobMcp,
          providerBaseUrl: opts.config.providerBaseUrl,
          providerApiKey: opts.providerApiKey,
          model,
          logger: log,
        };
        const kind = jobKindOf(job.jobUri);
        if (kind === 'task') {
          const handler = TASK_HANDLERS.get(job.jobUri);
          if (!handler) {
            result = { ok: false, skipped: 'agent_error', error: `no handler for ${job.jobUri}` };
          } else {
            result = await handler(ctx);
          }
        } else if (kind === 'skill') {
          const prefixes = toolPrefixesFor(job.jobUri);
          result = await runSkillPass({
            mcp: jobMcp,
            skills,
            providerBaseUrl: opts.config.providerBaseUrl,
            providerApiKey: opts.providerApiKey,
            model,
            skillUri: job.jobUri,
            userPrompt: job.userPrompt,
            assistantName: job.assistantName,
            maxToolIterations: 24,
            maxHistoryChars: opts.config.maxHistoryChars,
            allowedToolPrefixes: prefixes ? [...prefixes] : undefined,
            logger: log,
          });
        } else {
          result = { ok: false, skipped: 'agent_error', error: `unknown job uri scheme: ${job.jobUri}` };
        }
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
        if (result.totalTokens > 0) {
          await runWithServiceContext(this.db, opts.id, () =>
            this.health.recordSuccess(opts.id),
          ).catch((e) => log.warn(`recordSuccess failed: ${describe(e)}`));
        }
        return;
      }

      const retryable =
        result.skipped !== 'skill_missing' &&
        result.skipped !== 'no_admin_key' &&
        result.skipped !== 'no_provider_key';
      log.warn(`${job.id} skipped: ${result.skipped}${result.error ? ` (${result.error})` : ''}`);
      const failBody: { error: string; retryable: boolean; code?: string; failedStep?: string } = {
        error: `${result.skipped}${result.error ? `: ${result.error}` : ''}`,
        retryable,
      };
      if (result.skipped === 'provider_error' && result.code) {
        failBody.code = result.code;
        if (result.failedStep) failBody.failedStep = result.failedStep;
        const code = result.code;
        await runWithServiceContext(this.db, opts.id, () =>
          this.health.recordFailure(opts.id, code, result.error ?? result.skipped),
        ).catch((e) => log.warn(`recordFailure failed: ${describe(e)}`));
      }
      await opts.rest
        .failCuratorJob(job.id, failBody)
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

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
