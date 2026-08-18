import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@getmunin/core';
import { WebhookDispatcher } from '@getmunin/core';
import { AgentConfigService } from './config.service.ts';
import type { AgentHealthRecorder } from './agent-health.service.ts';
import type { ProviderModelLister } from './models.service.ts';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.ts';

const baseRow: AgentConfigRow = {
  id: 'singleton',
  fastModel: 'anthropic/claude-haiku-4.5',
  smartModel: null,
  providerBaseUrl: 'https://provider.example/v1',
  providerApiKeySet: false,
  maxHistoryChars: 32_000,
  maxToolIterations: 8,
  debounceMs: 500,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function makeRepo(opts: {
  before: AgentConfigRow;
  after: AgentConfigRow;
  apiKey?: string | null;
}): AgentConfigRepository & { update: ReturnType<typeof vi.fn> } {
  const update = vi.fn().mockResolvedValue(opts.after);
  return {
    resolveCurrentId: () => opts.before.id,
    resolveOrgId: (id: string) => Promise.resolve(id),
    read: vi.fn().mockResolvedValue(opts.before),
    update,
    listProvisionedIds: vi.fn().mockResolvedValue([]),
    readDecryptedProviderKey: vi.fn().mockResolvedValue(opts.apiKey ?? null),
  };
}

function makeModels(modelIds: string[] = []): ProviderModelLister & {
  listForProvider: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
} {
  return {
    invalidate: vi.fn(() => undefined),
    listForProvider: vi.fn().mockResolvedValue({
      supported: modelIds.length > 0,
      models: modelIds.map((id) => ({
        id,
        contextLength: null,
        promptCostPerMillion: null,
        completionCostPerMillion: null,
      })),
      fetchedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    }),
  };
}

class FakeWebhookDispatcher extends WebhookDispatcher {
  override emit = vi.fn().mockResolvedValue('evt_stub');
}

function makeWebhooks(): FakeWebhookDispatcher {
  return new FakeWebhookDispatcher();
}

function makeHealthStub(): AgentHealthRecorder & {
  recordSuccess: ReturnType<typeof vi.fn>;
  recordFailure: ReturnType<typeof vi.fn>;
} {
  return {
    recordSuccess: vi.fn().mockResolvedValue({ flipped: false }),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AgentConfigService', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) }),
    );
  });

  it('reads + serialises the row into a DTO with ISO timestamps', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const svc = new AgentConfigService(repo, makeWebhooks(), makeHealthStub(), makeModels());
    const dto = await svc.getForCurrentActor();
    expect(dto.id).toBe('singleton');
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('passes the patch through to the repo verbatim', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const svc = new AgentConfigService(repo, makeWebhooks(), makeHealthStub(), makeModels());

    const patch: AgentConfigPatch = {
      fastModel: 'a',
      smartModel: 'b',
      providerBaseUrl: 'https://x',
      maxHistoryChars: 64_000,
    };
    await svc.upsertForCurrentActor(patch);

    expect(repo.update).toHaveBeenCalledWith('singleton', patch);
  });

  it('emits a webhook on upsert', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const webhooks = makeWebhooks();
    const svc = new AgentConfigService(repo, webhooks, makeHealthStub(), makeModels());

    await svc.upsertForCurrentActor({ fastModel: 'x' });

    expect(webhooks.emit).toHaveBeenCalledWith({
      type: 'agent.config.updated',
      payload: { configId: 'singleton' },
    });
  });

  it('records success when fastModel changes so a degraded agent can recover', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const health = makeHealthStub();
    const svc = new AgentConfigService(repo, makeWebhooks(), health, makeModels());

    await svc.upsertForCurrentActor({ fastModel: 'anthropic/claude-sonnet-4.6' });

    expect(health.recordSuccess).toHaveBeenCalledWith('singleton');
  });

  it('records success when smartModel changes', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const health = makeHealthStub();
    const svc = new AgentConfigService(repo, makeWebhooks(), health, makeModels());

    await svc.upsertForCurrentActor({ smartModel: 'anthropic/claude-opus-4.7' });

    expect(health.recordSuccess).toHaveBeenCalledWith('singleton');
  });

  it('does not record success when model patch matches the existing value', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const health = makeHealthStub();
    const svc = new AgentConfigService(repo, makeWebhooks(), health, makeModels());

    await svc.upsertForCurrentActor({ fastModel: baseRow.fastModel });

    expect(health.recordSuccess).not.toHaveBeenCalled();
  });
});

describe('AgentConfigService provider/model reconciliation', () => {
  const ANTHROPIC = 'https://api.anthropic.com/v1';
  const openRouterRow: AgentConfigRow = {
    ...baseRow,
    providerBaseUrl: 'https://openrouter.ai/api/v1',
    providerApiKeySet: true,
  };

  beforeEach(() => {
    vi.spyOn(core, 'safeFetch').mockImplementation(
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets the model to the new provider default in the same write as the provider switch', async () => {
    const repo = makeRepo({ before: openRouterRow, after: openRouterRow, apiKey: 'sk-ant' });
    const webhooks = makeWebhooks();
    const svc = new AgentConfigService(
      repo,
      webhooks,
      makeHealthStub(),
      makeModels(['claude-haiku-4-5', 'claude-opus-5']),
    );

    await svc.upsertForCurrentActor({ providerBaseUrl: ANTHROPIC, providerApiKey: 'sk-ant' });

    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith('singleton', {
      providerBaseUrl: ANTHROPIC,
      providerApiKey: 'sk-ant',
      fastModel: 'claude-haiku-4-5',
    });
    expect(webhooks.emit).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first offered model when the provider has no known default', async () => {
    const repo = makeRepo({ before: openRouterRow, after: openRouterRow, apiKey: 'sk-x' });
    const svc = new AgentConfigService(
      repo,
      makeWebhooks(),
      makeHealthStub(),
      makeModels(['some-vendor-model', 'another-model']),
    );

    await svc.upsertForCurrentActor({ providerBaseUrl: 'https://llm.internal.example/v1' });

    expect(repo.update).toHaveBeenCalledWith('singleton', {
      providerBaseUrl: 'https://llm.internal.example/v1',
      fastModel: 'some-vendor-model',
    });
  });

  it('keeps the model when the new provider still offers it', async () => {
    const repo = makeRepo({ before: openRouterRow, after: openRouterRow, apiKey: 'sk-x' });
    const svc = new AgentConfigService(
      repo,
      makeWebhooks(),
      makeHealthStub(),
      makeModels([openRouterRow.fastModel, 'anthropic/claude-opus-5']),
    );

    await svc.upsertForCurrentActor({ providerBaseUrl: ANTHROPIC });

    expect(repo.update).toHaveBeenCalledWith('singleton', { providerBaseUrl: ANTHROPIC });
  });

  it('clears a smart model the new provider does not offer', async () => {
    const before = { ...openRouterRow, smartModel: 'anthropic/claude-opus-4.7' };
    const repo = makeRepo({ before, after: before, apiKey: 'sk-ant' });
    const svc = new AgentConfigService(
      repo,
      makeWebhooks(),
      makeHealthStub(),
      makeModels(['claude-haiku-4-5']),
    );

    await svc.upsertForCurrentActor({ providerBaseUrl: ANTHROPIC });

    expect(repo.update).toHaveBeenCalledWith('singleton', {
      providerBaseUrl: ANTHROPIC,
      fastModel: 'claude-haiku-4-5',
      smartModel: null,
    });
  });

  it('rejects a model the provider does not offer instead of persisting it', async () => {
    const repo = makeRepo({ before: openRouterRow, after: openRouterRow, apiKey: 'sk-x' });
    const svc = new AgentConfigService(
      repo,
      makeWebhooks(),
      makeHealthStub(),
      makeModels(['anthropic/claude-haiku-4.5']),
    );

    await expect(svc.upsertForCurrentActor({ fastModel: 'gpt-oss-120b' })).rejects.toThrow(
      /agent_config_invalid_model/,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('leaves models untouched when the provider serves no model list', async () => {
    const repo = makeRepo({ before: openRouterRow, after: openRouterRow, apiKey: 'sk-x' });
    const svc = new AgentConfigService(repo, makeWebhooks(), makeHealthStub(), makeModels([]));

    await svc.upsertForCurrentActor({ providerBaseUrl: ANTHROPIC, fastModel: 'whatever-they-call-it' });

    expect(repo.update).toHaveBeenCalledWith('singleton', {
      providerBaseUrl: ANTHROPIC,
      fastModel: 'whatever-they-call-it',
    });
  });

  it('does not consult the provider when only unrelated settings change', async () => {
    const repo = makeRepo({ before: openRouterRow, after: openRouterRow, apiKey: 'sk-x' });
    const models = makeModels(['anthropic/claude-haiku-4.5']);
    const svc = new AgentConfigService(repo, makeWebhooks(), makeHealthStub(), models);

    await svc.upsertForCurrentActor({ debounceMs: 750 });

    expect(models.listForProvider).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('singleton', { debounceMs: 750 });
  });

  it('drops the cached model list when the provider key is replaced', async () => {
    const anthropicRow = {
      ...openRouterRow,
      providerBaseUrl: ANTHROPIC,
      fastModel: 'claude-haiku-4-5',
    };
    const repo = makeRepo({ before: anthropicRow, after: anthropicRow, apiKey: 'sk-old' });
    const models = makeModels(['claude-haiku-4-5']);
    const svc = new AgentConfigService(repo, makeWebhooks(), makeHealthStub(), models);

    await svc.upsertForCurrentActor({ providerApiKey: 'sk-new' });

    expect(models.invalidate).toHaveBeenCalledWith('singleton');
  });

  it('keeps the cached model list when the key is untouched', async () => {
    const repo = makeRepo({ before: openRouterRow, after: openRouterRow, apiKey: 'sk-x' });
    const models = makeModels(['anthropic/claude-haiku-4.5']);
    const svc = new AgentConfigService(repo, makeWebhooks(), makeHealthStub(), models);

    await svc.upsertForCurrentActor({ debounceMs: 750 });

    expect(models.invalidate).not.toHaveBeenCalled();
  });
});
