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
import { schema, type Db } from '@getmunin/db';
import { and, eq } from 'drizzle-orm';
import {
  InProcessMuninRestClientFactoryService,
  McpRegistryService,
  McpSkillRegistryService,
  RateLimitService,
  RealtimeEventBus,
  IDENTITY_ASSERTION_HEADER,
  listExternalMcpEndpoints,
  openAdminAgentMcpClient,
  openEndUserAgentMcpClient,
  type AgentMcpClient,
  type ExternalMcpEndpoint,
  type AgentConfigChangedBusEvent,
  type CuratorJobPendingBusEvent,
  type GreetRequestedBusEvent,
  type KbDocumentChangedBusEvent,
  type MessageReceivedBusEvent,
  type RealtimeBusSubscription,
} from '@getmunin/backend-core';
import { getCurrentContext, parseEnvBool, safeFetchCompat } from '@getmunin/core';
import {
  composeToolHandles,
  createConversationHandler,
  createPromptResolver,
  openAiCompatibleProvider,
  openHttpMcpClient,
  runSkillPass,
  type ExternalToolSource,
  type AwaitingReplyConversation,
  type ConversationHandler,
  type CuratorJob,
  type HandlerConfig,
  type MuninRestClient,
  type PromptResolver,
  type Provider,
  type SkillPassResult,
  type SkillReader,
} from '@getmunin/agent-runtime';
import {
  jobKindOf,
  tierFor,
  toolPrefixesFor,
  WEB_SCRAPE_SITE_TASK_URI,
  type WebImportProgress,
} from '@getmunin/types';
import { AGENT_CONFIG_REPOSITORY, AGENT_HOST_DB } from './injection-tokens.ts';
import type { AgentConfigRepository, AgentConfigRow } from './config.repository.ts';
import { runWithServiceContext } from './service-context.ts';
import { ReplicaLockManager } from './replica-lock.ts';
import { runWebImportJob } from './web-import.handler.ts';
import { AgentHealthService } from './agent-health.service.ts';
import { createMeteringProvider } from './usage-metering.ts';
import { createDrainScheduler, type DrainScheduler } from './drain-scheduler.ts';
import { drainCuratorQueue } from './curator-drain.ts';

interface TaskHandlerContext {
  job: CuratorJob;
  mcp: AgentMcpClient;
  providerBaseUrl: string;
  providerApiKey: string;
  model: string;
  provider?: Provider;
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  onProgress?: (p: WebImportProgress) => void;
}

type TaskHandler = (ctx: TaskHandlerContext) => Promise<SkillPassResult>;

const TASK_HANDLERS: ReadonlyMap<string, TaskHandler> = new Map([
  [WEB_SCRAPE_SITE_TASK_URI, (ctx: TaskHandlerContext) => runWebImportJob(ctx)],
]);

const RECONCILE_INTERVAL_MS = 30_000;
const CURATOR_LEASE_SECONDS = 600;
const CURATOR_MAX_SCHEDULED_DELAY_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_SWEEP_LIMIT = 50;
const CURATOR_MAX_TOOL_ITERATIONS = 16;
const CURATOR_DRAIN_SPACING_MS = 5_000;
const CURATOR_DRAIN_MAX_JOBS = 25;
const EXTERNAL_MCP_CONNECT_TIMEOUT_MS = 5_000;

const BASE_END_USER_AGENT_SCOPES: readonly string[] = [
  'conv:read',
  'conv:write',
  'crm:read',
  'crm:write',
  'kb:read',
];

const CONNECTOR_DOMAIN_SCOPES: ReadonlyMap<string, readonly string[]> = new Map([
  ['commerce', ['commerce:read']],
  ['bookings', ['bookings:read', 'bookings:write']],
]);

export function endUserScopesForConnectorDomains(
  domains: readonly string[],
): readonly string[] {
  const scopes = [...BASE_END_USER_AGENT_SCOPES];
  for (const domain of new Set(domains)) {
    scopes.push(...(CONNECTOR_DOMAIN_SCOPES.get(domain) ?? []));
  }
  return scopes;
}

export type GenerateTrigger = 'chat' | 'scheduled';

export interface ResolvedProviderAuth {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  managed: boolean;
}

export interface AgentHostRunnerOptions {
  databaseUrl?: string;
  resolveProviderAuth?: (
    orgId: string,
    config: AgentConfigRow,
  ) => Promise<ResolvedProviderAuth | null>;
  createProvider?: (args: {
    orgId: string;
    config: AgentConfigRow;
    managed: boolean;
  }) => Provider;
  beforeGenerate?: (args: {
    orgId: string;
    config: AgentConfigRow;
    managed: boolean;
    trigger: GenerateTrigger;
  }) => Promise<{ allowed: boolean; reason?: string }>;
}

interface PerConfigRunner {
  realtime: RealtimeBusSubscription;
  handler: ConversationHandler;
  prompts: PromptResolver;
  adminMcp: AgentMcpClient;
  curatorWorker: CuratorWorker;
  sweeper: ConversationSweeper;
}

interface CuratorWorker {
  onPending(event: CuratorJobPendingBusEvent): void;
  onConnected(): void;
  stop(): Promise<void>;
}

interface ConversationSweeper {
  sweep(): void;
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
  private readonly options?: AgentHostRunnerOptions;
  private readonly drainScheduler: DrainScheduler = createDrainScheduler(
    CURATOR_DRAIN_SPACING_MS,
  );

  constructor(
    @Inject(AGENT_CONFIG_REPOSITORY) private readonly repo: AgentConfigRepository,
    @Inject(AGENT_HOST_DB) private readonly db: Db,
    @Inject(McpRegistryService) private readonly mcpRegistry: McpRegistryService,
    @Inject(McpSkillRegistryService) private readonly mcpSkills: McpSkillRegistryService,
    @Inject(RealtimeEventBus) private readonly eventBus: RealtimeEventBus,
    @Inject(InProcessMuninRestClientFactoryService)
    private readonly restClientFactory: InProcessMuninRestClientFactoryService,
    @Inject(AgentHealthService) private readonly health: AgentHealthService,
    @Optional() @Inject(RateLimitService) private readonly rateLimit: RateLimitService | undefined,
    @Optional() @Inject('AGENT_HOST_RUNNER_OPTIONS') options?: AgentHostRunnerOptions,
  ) {
    this.options = options;
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
    if (!parseEnvBool({ name: 'MUNIN_BUILTIN_AGENT', default: true })) {
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
        await r.sweeper.stop();
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
        await runner.sweeper.stop();
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

    for (const runner of this.runners.values()) {
      runner.sweeper.sweep();
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
          await existing.sweeper.stop();
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

  private async defaultResolveProviderAuth(id: string): Promise<ResolvedProviderAuth | null> {
    const apiKey = await this.repo.readDecryptedProviderKey(id);
    return apiKey ? { apiKey, managed: false } : null;
  }

  private meteringProvider(id: string, orgId: string): Provider {
    return createMeteringProvider(openAiCompatibleProvider, (totalTokens) => {
      const rateLimit = this.rateLimit;
      if (!rateLimit) return;
      void runWithServiceContext(
        this.db,
        id,
        async () => {
          await rateLimit.record('ai_tokens_day', totalTokens);
          await rateLimit.record('ai_tokens_month', totalTokens);
        },
        { orgId },
      ).catch((err) =>
        this.scopedLogger(id, 'usage').warn(`ai-token record failed: ${describe(err)}`),
      );
    });
  }

  private async spawnRunner(id: string): Promise<PerConfigRunner | null> {
    const config = await runWithServiceContext(this.db, id, () => this.repo.read(id));
    const orgId = await runWithServiceContext(this.db, id, () => this.repo.resolveOrgId(id));
    const auth = await runWithServiceContext(
      this.db,
      id,
      () =>
        this.options?.resolveProviderAuth
          ? this.options.resolveProviderAuth(orgId, config)
          : this.defaultResolveProviderAuth(id),
      { orgId },
    );

    if (!auth) {
      this.logger.warn(`${id}: enabled but no LLM provider available`);
      return null;
    }

    const providerApiKey = auth.apiKey;
    const providerBaseUrl = auth.baseUrl ?? config.providerBaseUrl;
    const fastModel = auth.model ?? config.fastModel;
    const smartModel = auth.model ?? config.smartModel ?? config.fastModel;
    const managed = auth.managed;
    const provider =
      this.options?.createProvider?.({ orgId, config, managed }) ??
      this.meteringProvider(id, orgId);

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
      providerBaseUrl,
      providerApiKey,
      model: fastModel,
      maxToolIterations: config.maxToolIterations,
      maxHistoryChars: config.maxHistoryChars,
      debounceMs: config.debounceMs,
    };

    const curatorWorker = this.buildCuratorWorker({
      id,
      orgId,
      config,
      rest,
      providerBaseUrl,
      providerApiKey,
      fastModel,
      smartModel,
      provider,
      managed,
    });

    const handlerRef: { current: ConversationHandler | null } = { current: null };
    const sweeper = this.buildConversationSweeper({ id, rest, handlerRef });
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
        onConnected: () => {
          curatorWorker.onConnected();
          sweeper.sweep();
        },
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
      openMcp: async ({ endUserId }) => {
        const inner = openEndUserAgentMcpClient({
          db: this.db,
          orgId,
          endUserId,
          registry: this.mcpRegistry,
          skills: this.mcpSkills,
          scopes: await this.endUserAgentScopes(id, orgId),
        });
        const extLog = this.scopedLogger(id, 'ext-mcp');
        const externals = await this.openExternalMcpHandles(orgId, endUserId, extLog);
        if (externals.length === 0) return inner;
        const composed = composeToolHandles(inner, externals, extLog);
        return {
          listTools: () => composed.listTools(),
          callTool: (name, args) => composed.callTool(name, args),
          close: async () => {
            await Promise.all(externals.map((ext) => ext.close().catch(() => undefined)));
            await inner.close();
          },
        };
      },
      provider,
      beforeGenerate: this.options?.beforeGenerate
        ? () =>
            runWithServiceContext(
              this.db,
              id,
              () =>
                this.options!.beforeGenerate!({ orgId, config, managed, trigger: 'chat' }),
              { orgId },
            )
        : undefined,
      holderId: this.holderId,
      logger: this.scopedLogger(id, 'chat'),
      onTyping: (conversationId, isTyping) =>
        this.eventBus.publishConversationTyping(orgId, conversationId, isTyping),
      onProviderError: (code, message) => {
        const detail = withProviderContext(message, fastModel, providerBaseUrl);
        void runWithServiceContext(
          this.db,
          id,
          () => this.health.recordFailure(id, code, detail),
          { orgId },
        ).catch((err) =>
          this.scopedLogger(id, 'chat').warn(`recordFailure failed: ${describe(err)}`),
        );
      },
      onProviderSuccess: () => {
        void runWithServiceContext(this.db, id, () => this.health.recordSuccess(id), {
          orgId,
        }).catch((err) =>
          this.scopedLogger(id, 'chat').warn(`recordSuccess failed: ${describe(err)}`),
        );
      },
    });
    handlerRef.current = handler;

    return { realtime, handler, prompts, adminMcp, curatorWorker, sweeper };
  }

  private buildConversationSweeper(opts: {
    id: string;
    rest: MuninRestClient;
    handlerRef: { current: ConversationHandler | null };
  }): ConversationSweeper {
    const log = this.scopedLogger(opts.id, 'sweep');
    let stopped = false;
    let pending: Promise<void> | null = null;

    const runSweep = async (): Promise<void> => {
      if (stopped) return;
      if (this.lockManager && !this.lockManager.holds(opts.id)) return;
      let candidates: AwaitingReplyConversation[];
      try {
        candidates = await opts.rest.listConversationsAwaitingReply({
          limit: CONVERSATION_SWEEP_LIMIT,
        });
      } catch (err) {
        log.warn(`sweep failed: ${describe(err)}`);
        return;
      }
      if (stopped || candidates.length === 0) return;
      log.info(`recovering ${candidates.length} unanswered conversation(s)`);
      for (const c of candidates) {
        if (stopped) break;
        opts.handlerRef.current?.handle({ conversationId: c.id, authorType: 'end_user' });
      }
    };

    return {
      sweep() {
        if (stopped || pending) return;
        pending = runSweep().finally(() => {
          pending = null;
        });
        void pending;
      },
      async stop() {
        stopped = true;
        await pending?.catch(() => undefined);
      },
    };
  }

  private buildCuratorWorker(opts: {
    id: string;
    orgId: string;
    config: AgentConfigRow;
    rest: MuninRestClient;
    providerBaseUrl: string;
    providerApiKey: string;
    fastModel: string;
    smartModel: string;
    provider?: Provider;
    managed: boolean;
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

    const smartModel = opts.smartModel;
    const fastModel = opts.fastModel;

    const executeOne = async (job: CuratorJob): Promise<boolean> => {
      log.info(`running ${job.jobUri} for ${job.id} (attempt ${job.attempts}/${job.maxAttempts})`);
      const model = tierFor(job.jobUri) === 'fast' ? fastModel : smartModel;
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
        const ctx: TaskHandlerContext = {
          job,
          mcp: jobMcp,
          providerBaseUrl: opts.providerBaseUrl,
          providerApiKey: opts.providerApiKey,
          model,
          provider: opts.provider,
          logger: log,
          onProgress: makeProgressWriter(job.id, opts.rest),
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
            providerBaseUrl: opts.providerBaseUrl,
            providerApiKey: opts.providerApiKey,
            model,
            skillUri: job.jobUri,
            userPrompt: job.userPrompt,
            assistantName: job.assistantName,
            maxToolIterations: CURATOR_MAX_TOOL_ITERATIONS,
            maxHistoryChars: opts.config.maxHistoryChars,
            providerImpl: opts.provider,
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
        return false;
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
          await runWithServiceContext(
            this.db,
            opts.id,
            () => this.health.recordSuccess(opts.id),
            { orgId: opts.orgId },
          ).catch((e) => log.warn(`recordSuccess failed: ${describe(e)}`));
        }
        return false;
      }

      const retryable =
        result.skipped !== 'skill_missing' &&
        result.skipped !== 'no_admin_key' &&
        result.skipped !== 'no_provider_key' &&
        result.skipped !== 'quota_exceeded';
      log.warn(`${job.id} skipped: ${result.skipped}${result.error ? ` (${result.error})` : ''}`);
      const failBody: { error: string; retryable: boolean; code?: string; failedStep?: string } = {
        error: `${result.skipped}${result.error ? `: ${result.error}` : ''}`,
        retryable,
      };
      if (result.skipped === 'provider_error' && result.code) {
        failBody.code = result.code;
        if (result.failedStep) failBody.failedStep = result.failedStep;
        const code = result.code;
        const detail = withProviderContext(
          result.error ?? result.skipped,
          model,
          opts.providerBaseUrl,
        );
        await runWithServiceContext(
          this.db,
          opts.id,
          () => this.health.recordFailure(opts.id, code, detail),
          { orgId: opts.orgId },
        ).catch((e) => log.warn(`recordFailure failed: ${describe(e)}`));
      }
      await opts.rest
        .failCuratorJob(job.id, failBody)
        .catch((e) => log.error(`fail-report failed: ${describe(e)}`));
      return result.skipped === 'provider_error';
    };

    const admit = async (): Promise<boolean> => {
      if (!this.options?.beforeGenerate) return true;
      const verdict = await runWithServiceContext(
        this.db,
        opts.id,
        () =>
          this.options!.beforeGenerate!({
            orgId: opts.orgId,
            config: opts.config,
            managed: opts.managed,
            trigger: 'scheduled',
          }),
        { orgId: opts.orgId },
      ).catch((err): { allowed: boolean; reason?: string } => {
        log.warn(`beforeGenerate failed, proceeding: ${describe(err)}`);
        return { allowed: true };
      });
      if (!verdict.allowed) {
        log.info(`scheduled work suppressed: ${verdict.reason ?? 'gate denied'}`);
        return false;
      }
      return true;
    };

    const pollOnce = async (): Promise<void> => {
      if (stopped) return;
      const outcome = await drainCuratorQueue<CuratorJob>({
        admit,
        claim: () =>
          opts.rest.claimCuratorJobs({
            holder: this.holderId,
            limit: 1,
            leaseSeconds: CURATOR_LEASE_SECONDS,
          }),
        execute: executeOne,
        maxJobs: CURATOR_DRAIN_MAX_JOBS,
        isStopped: () => stopped,
        onClaimError: (err) => log.warn(`claim failed: ${describe(err)}`),
      });
      if (outcome === 'paused') {
        log.info(`drained ${CURATOR_DRAIN_MAX_JOBS} jobs — re-queueing the rest behind other orgs`);
        scheduleDrain('batch limit');
      }
      if (outcome === 'provider_unhealthy') {
        log.warn('provider unhealthy — leaving the rest of the queue for the next drain');
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

    let cancelDrain: (() => void) | null = null;
    const scheduleDrain = (reason: string): void => {
      if (cancelDrain) return;
      cancelDrain = this.drainScheduler.enqueue(() => {
        cancelDrain = null;
        if (stopped) return;
        log.info(`draining queue (${reason})`);
        triggerPoll();
      });
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
        scheduleDrain('realtime connected');
      },
      async stop() {
        stopped = true;
        cancelDrain?.();
        cancelDrain = null;
        for (const t of scheduledByJob.values()) clearTimeout(t);
        scheduledByJob.clear();
        await Promise.allSettled([...inFlight]);
      },
    };
  }

  private async openExternalMcpHandles(
    orgId: string,
    endUserId: string,
    log: { warn: (m: string) => void },
  ): Promise<Array<ExternalToolSource & { close(): Promise<void> }>> {
    let endpoints: ExternalMcpEndpoint[];
    try {
      endpoints = await listExternalMcpEndpoints(this.db, { orgId, endUserId });
    } catch (err) {
      log.warn(`external MCP endpoint lookup failed: ${describe(err)}`);
      return [];
    }
    const handles: Array<ExternalToolSource & { close(): Promise<void> }> = [];
    for (const endpoint of endpoints) {
      try {
        const client = await withDeadline(
          openHttpMcpClient({
            url: endpoint.url,
            bearerToken: endpoint.bearerToken,
            clientName: 'munin-agent',
            headers: { [IDENTITY_ASSERTION_HEADER]: endpoint.identityAssertion },
            fetchImpl: safeFetchCompat,
          }),
          EXTERNAL_MCP_CONNECT_TIMEOUT_MS,
        );
        handles.push({ slug: endpoint.slug, handle: client, close: () => client.close() });
      } catch (err) {
        log.warn(`external MCP ${endpoint.slug} unavailable, continuing without it: ${describe(err)}`);
      }
    }
    return handles;
  }

  private async endUserAgentScopes(configId: string, orgId: string): Promise<readonly string[]> {
    try {
      const rows = await runWithServiceContext(
        this.db,
        configId,
        async () => {
          const ctx = getCurrentContext();
          return ctx.db
            .selectDistinct({ domain: schema.connectorConnections.domain })
            .from(schema.connectorConnections)
            .where(
              and(
                eq(schema.connectorConnections.orgId, orgId),
                eq(schema.connectorConnections.active, true),
              ),
            );
        },
        { orgId },
      );
      return endUserScopesForConnectorDomains(rows.map((r) => r.domain));
    } catch (err) {
      this.scopedLogger(configId, 'chat').warn(`connector scope lookup failed: ${describe(err)}`);
      return endUserScopesForConnectorDomains([...CONNECTOR_DOMAIN_SCOPES.keys()]);
    }
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

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function withProviderContext(message: string, model: string, providerBaseUrl: string): string {
  return `${message} (model=${model}, provider=${providerBaseUrl})`;
}

const PROGRESS_THROTTLE_MS = 750;

function makeProgressWriter(
  jobId: string,
  rest: MuninRestClient,
): (p: WebImportProgress) => void {
  let lastWriteAt = 0;
  let pending: WebImportProgress | null = null;
  let timer: NodeJS.Timeout | null = null;

  const flush = (p: WebImportProgress): void => {
    lastWriteAt = Date.now();
    void rest.updateCuratorJobProgress(jobId, { progress: p }).catch(() => {});
  };

  return (p) => {
    const sinceLast = Date.now() - lastWriteAt;
    const isFinal = p.total > 0 && p.done >= p.total;
    if (lastWriteAt === 0 || isFinal || sinceLast >= PROGRESS_THROTTLE_MS) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      flush(p);
      return;
    }
    pending = p;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        if (pending) {
          const next = pending;
          pending = null;
          flush(next);
        }
      }, PROGRESS_THROTTLE_MS - sinceLast);
    }
  };
}
