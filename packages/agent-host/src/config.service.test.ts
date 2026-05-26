import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookDispatcher } from '@getmunin/core';
import { AgentConfigService } from './config.service.js';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.js';

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
}): AgentConfigRepository & { update: ReturnType<typeof vi.fn> } {
  const update = vi.fn().mockResolvedValue(opts.after);
  return {
    resolveCurrentId: () => opts.before.id,
    resolveOrgId: (id: string) => Promise.resolve(id),
    read: vi.fn().mockResolvedValue(opts.before),
    update,
    listProvisionedIds: vi.fn().mockResolvedValue([]),
    readDecryptedProviderKey: vi.fn().mockResolvedValue(null),
  };
}

function makeWebhooks(): WebhookDispatcher & { emit: ReturnType<typeof vi.fn> } {
  const stub = { emit: vi.fn().mockResolvedValue('evt_stub') };
  return stub;
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
    const svc = new AgentConfigService(repo, makeWebhooks());
    const dto = await svc.getForCurrentActor();
    expect(dto.id).toBe('singleton');
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('passes the patch through to the repo verbatim', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const svc = new AgentConfigService(repo, makeWebhooks());

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
    const svc = new AgentConfigService(repo, webhooks);

    await svc.upsertForCurrentActor({ fastModel: 'x' });

    expect(webhooks.emit).toHaveBeenCalledWith({
      type: 'agent.config.updated',
      payload: { configId: 'singleton' },
    });
  });
});
