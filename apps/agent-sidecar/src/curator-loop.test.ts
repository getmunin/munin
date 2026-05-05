import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startCurators } from './curator-loop.js';
import type { SidecarConfig } from './config.js';
import type {
  AckCuratorJobInput,
  ClaimCuratorJobsInput,
  CuratorJob,
  EnqueueCuratorJobInput,
  FailCuratorJobInput,
  MuninRestClient,
  SkillPassResult,
} from '@getmunin/agent-runtime';

const baseConfig: SidecarConfig = {
  muninBaseUrl: 'http://localhost:3001',
  muninAdminApiKey: 'mn_admin_test',
  providerBaseUrl: 'https://openrouter.ai/api/v1',
  providerApiKey: 'pk_test',
  model: 'anthropic/claude-haiku-4.5',
  debounceMs: 500,
  maxToolIterations: 8,
  maxHistoryChars: 32_000,
  promptsDir: '/tmp/prompts',
  curatorsDisabled: false,
  kbCurationOnHandover: true,
};

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const okResult = (): SkillPassResult => ({
  ok: true,
  toolCalls: 1,
  totalTokens: 100,
  finishReason: 'stop',
  replyText: 'done',
});

function makeJob(partial: Partial<CuratorJob> = {}): CuratorJob {
  return {
    id: partial.id ?? 'cjob_test_1',
    orgId: partial.orgId ?? 'org_test',
    skillUri: partial.skillUri ?? 'skill://kb/curation',
    userPrompt: partial.userPrompt ?? 'do the thing',
    sourceEventType: partial.sourceEventType ?? 'conversation.handover_resolved',
    sourceEventPayload: partial.sourceEventPayload ?? null,
    dedupeKey: partial.dedupeKey ?? null,
    status: partial.status ?? 'pending',
    attempts: partial.attempts ?? 1,
    maxAttempts: partial.maxAttempts ?? 5,
    nextAttemptAt: partial.nextAttemptAt ?? new Date().toISOString(),
    leaseExpiresAt: partial.leaseExpiresAt ?? null,
    leaseHolder: partial.leaseHolder ?? null,
    lastError: partial.lastError ?? null,
    lastReplyText: partial.lastReplyText ?? null,
    lastToolCalls: partial.lastToolCalls ?? null,
    lastTotalTokens: partial.lastTotalTokens ?? null,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
    doneAt: partial.doneAt ?? null,
  };
}

interface RestSpy {
  rest: MuninRestClient;
  enqueued: EnqueueCuratorJobInput[];
  claims: ClaimCuratorJobsInput[];
  acks: Array<{ id: string; input: AckCuratorJobInput }>;
  fails: Array<{ id: string; input: FailCuratorJobInput }>;
  setNextClaim: (jobs: CuratorJob[]) => void;
}

function buildRest(): RestSpy {
  const enqueued: EnqueueCuratorJobInput[] = [];
  const claims: ClaimCuratorJobsInput[] = [];
  const acks: Array<{ id: string; input: AckCuratorJobInput }> = [];
  const fails: Array<{ id: string; input: FailCuratorJobInput }> = [];
  let nextClaim: CuratorJob[] = [];

  const rest: MuninRestClient = {
    getConversation: vi.fn(),
    postAgentMessage: vi.fn(),
    postInternalNote: vi.fn(),
    mintDelegatedToken: vi.fn(),
    toRuntimeHistory: () => [],
    changeStatus: vi.fn(),
    setTopic: vi.fn(),
    listTopics: vi.fn(),
    enqueueCuratorJob: vi.fn((input: EnqueueCuratorJobInput) => {
      enqueued.push(input);
      return Promise.resolve({ job: makeJob({ id: `cjob_enq_${enqueued.length}` }), alreadyPending: false });
    }),
    tryAcquireConversation: vi.fn(() =>
      Promise.resolve({ acquired: true, leaseExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    ),
    releaseConversationClaim: vi.fn(() => Promise.resolve({ released: true })),
    claimCuratorJobs: vi.fn((input: ClaimCuratorJobsInput) => {
      claims.push(input);
      const out = nextClaim;
      nextClaim = [];
      return Promise.resolve(out);
    }),
    ackCuratorJob: vi.fn((id: string, input: AckCuratorJobInput = {}) => {
      acks.push({ id, input });
      return Promise.resolve(makeJob({ id, status: 'done' }));
    }),
    failCuratorJob: vi.fn((id: string, input: FailCuratorJobInput) => {
      fails.push({ id, input });
      return Promise.resolve(makeJob({ id, status: 'failed' }));
    }),
  };

  return {
    rest,
    enqueued,
    claims,
    acks,
    fails,
    setNextClaim: (jobs) => {
      nextClaim = jobs;
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('startCurators', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('claims a pending job after onCuratorJobPending, runs it, and acks', async () => {
    const spy = buildRest();
    const job = makeJob({ id: 'cjob_handover' });

    const skillUris: string[] = [];
    const runSkillPassImpl = vi.fn((opts: { skillUri: string }): Promise<SkillPassResult> => {
      skillUris.push(opts.skillUri);
      return Promise.resolve(okResult());
    });
    const curators = startCurators({
      config: baseConfig,
      rest: spy.rest,
      logger: silentLogger,
      runSkillPassImpl,
    });

    await flush();
    spy.setNextClaim([job]);
    curators.onCuratorJobPending({
      jobId: 'ccv_x',
      skillUri: 'skill://kb/curation',
      dedupeKey: null,
      nextAttemptAt: new Date().toISOString(),
    });
    await flush();
    await curators.stop();

    expect(runSkillPassImpl).toHaveBeenCalled();
    expect(skillUris).toContain('skill://kb/curation');
    expect(spy.acks.map((a) => a.id)).toContain('cjob_handover');
  });

  it('reports retryable failure when runSkillPass returns transient skipped reason', async () => {
    const spy = buildRest();
    const job = makeJob({ id: 'cjob_fail' });

    const runSkillPassImpl = vi.fn(
      (): Promise<SkillPassResult> =>
        Promise.resolve({ ok: false, skipped: 'mcp_connect_failed', error: 'ECONNREFUSED' }),
    );
    const curators = startCurators({
      config: baseConfig,
      rest: spy.rest,
      logger: silentLogger,
      runSkillPassImpl,
    });

    await flush();
    spy.setNextClaim([job]);
    curators.onCuratorJobPending({
      jobId: 'ccv_y',
      skillUri: 'skill://kb/curation',
      dedupeKey: null,
      nextAttemptAt: new Date().toISOString(),
    });
    await flush();
    await curators.stop();

    const fail = spy.fails.find((f) => f.id === 'cjob_fail');
    expect(fail).toBeDefined();
    expect(fail?.input.retryable).not.toBe(false);
    expect(fail?.input.error).toContain('mcp_connect_failed');
  });

  it('reports non-retryable failure for skill_missing', async () => {
    const spy = buildRest();
    const job = makeJob({ id: 'cjob_missing' });

    const runSkillPassImpl = vi.fn(
      (): Promise<SkillPassResult> => Promise.resolve({ ok: false, skipped: 'skill_missing' }),
    );
    const curators = startCurators({
      config: baseConfig,
      rest: spy.rest,
      logger: silentLogger,
      runSkillPassImpl,
    });

    await flush();
    spy.setNextClaim([job]);
    curators.onCuratorJobPending({
      jobId: 'ccv_z',
      skillUri: 'skill://kb/curation',
      dedupeKey: null,
      nextAttemptAt: new Date().toISOString(),
    });
    await flush();
    await curators.stop();

    const fail = spy.fails.find((f) => f.id === 'cjob_missing');
    expect(fail).toBeDefined();
    expect(fail?.input.retryable).toBe(false);
  });

  it('does not claim or enqueue when curatorsDisabled is true', async () => {
    const spy = buildRest();
    const runSkillPassImpl = vi.fn(() => Promise.resolve(okResult()));
    const curators = startCurators({
      config: { ...baseConfig, curatorsDisabled: true },
      rest: spy.rest,
      logger: silentLogger,
      runSkillPassImpl,
    });

    curators.onCuratorJobPending({
      jobId: 'ccv_x',
      skillUri: 'skill://kb/curation',
      dedupeKey: null,
      nextAttemptAt: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await curators.stop();

    expect(spy.claims).toHaveLength(0);
    expect(spy.enqueued).toHaveLength(0);
    expect(runSkillPassImpl).not.toHaveBeenCalled();
  });

  it('schedules a setTimeout for future-dated curator_job.pending and fires when due', async () => {
    const spy = buildRest();
    const job = makeJob({ id: 'cjob_retry' });

    const skillUris: string[] = [];
    const runSkillPassImpl = vi.fn((opts: { skillUri: string }): Promise<SkillPassResult> => {
      skillUris.push(opts.skillUri);
      return Promise.resolve(okResult());
    });
    const curators = startCurators({
      config: baseConfig,
      rest: spy.rest,
      logger: silentLogger,
      runSkillPassImpl,
    });

    await flush();
    spy.claims.length = 0;

    const futureMs = 30_000;
    curators.onCuratorJobPending({
      jobId: 'cjob_retry',
      skillUri: 'skill://kb/curation',
      dedupeKey: null,
      nextAttemptAt: new Date(Date.now() + futureMs).toISOString(),
    });

    await flush();
    expect(spy.claims).toHaveLength(0);

    spy.setNextClaim([job]);
    await vi.advanceTimersByTimeAsync(futureMs + 100);
    await flush();
    await curators.stop();

    expect(spy.claims.length).toBeGreaterThan(0);
    expect(spy.acks.map((a) => a.id)).toContain('cjob_retry');
  });

  it('drains the queue when realtime connects (catch-up after downtime)', async () => {
    const spy = buildRest();
    const job = makeJob({ id: 'cjob_buffered' });

    const runSkillPassImpl = vi.fn((): Promise<SkillPassResult> => Promise.resolve(okResult()));
    const curators = startCurators({
      config: baseConfig,
      rest: spy.rest,
      logger: silentLogger,
      runSkillPassImpl,
    });

    await flush();
    spy.claims.length = 0;
    spy.setNextClaim([job]);

    curators.onConnected();
    await flush();
    await curators.stop();

    expect(spy.claims.length).toBeGreaterThan(0);
    expect(spy.acks.map((a) => a.id)).toContain('cjob_buffered');
  });

});
