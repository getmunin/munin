import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentModelsService } from './models.service.js';
import type { AgentConfigRepository, AgentConfigRow } from './config.repository.js';

const baseRow: AgentConfigRow = {
  id: 'singleton',
  fastModel: 'anthropic/claude-haiku-4.5',
  smartModel: null,
  providerBaseUrl: 'https://provider.example/v1',
  providerApiKeySet: true,
  maxHistoryChars: 32_000,
  maxToolIterations: 8,
  debounceMs: 500,
  adminApiKeyId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRepo(overrides: { apiKey?: string | null; row?: AgentConfigRow } = {}): AgentConfigRepository {
  const row = overrides.row ?? baseRow;
  const apiKey = 'apiKey' in overrides ? overrides.apiKey : 'sk-test';
  return {
    resolveCurrentId: () => row.id,
    resolveOrgId: (id: string) => Promise.resolve(id),
    read: vi.fn().mockResolvedValue(row),
    update: vi.fn().mockResolvedValue(row),
    listProvisionedIds: vi.fn().mockResolvedValue([]),
    readDecryptedProviderKey: vi.fn().mockResolvedValue(apiKey),
    readDecryptedAdminKey: vi.fn().mockResolvedValue(null),
  };
}

function mockFetch(response: { status: number; body?: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: () => Promise.resolve(response.body),
    }),
  );
}

describe('AgentModelsService', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns supported:false when no provider key is stored', async () => {
    const repo = makeRepo({ apiKey: null });
    const svc = new AgentModelsService(repo);
    const result = await svc.listForCurrentActor();
    expect(result.supported).toBe(false);
    expect(result.models).toEqual([]);
  });

  it('parses OpenRouter-shaped responses with context_length and pricing', async () => {
    mockFetch({
      status: 200,
      body: {
        data: [
          {
            id: 'anthropic/claude-haiku-4.5',
            context_length: 200_000,
            pricing: { prompt: '0.000001', completion: '0.000005' },
          },
          {
            id: 'anthropic/claude-sonnet-4-6',
            context_length: 200_000,
            pricing: { prompt: '0.000003', completion: '0.000015' },
          },
        ],
      },
    });
    const svc = new AgentModelsService(makeRepo());
    const result = await svc.listForCurrentActor();
    expect(result.supported).toBe(true);
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toEqual({
      id: 'anthropic/claude-haiku-4.5',
      contextLength: 200_000,
      promptCostPerMillion: 1,
      completionCostPerMillion: 5,
    });
    expect(result.models[1]?.promptCostPerMillion).toBe(3);
  });

  it('handles entries without pricing or context_length (raw OpenAI shape)', async () => {
    mockFetch({
      status: 200,
      body: {
        data: [
          { id: 'gpt-4o-mini', object: 'model', created: 0, owned_by: 'openai' },
        ],
      },
    });
    const svc = new AgentModelsService(makeRepo());
    const result = await svc.listForCurrentActor();
    expect(result.supported).toBe(true);
    expect(result.models[0]).toEqual({
      id: 'gpt-4o-mini',
      contextLength: null,
      promptCostPerMillion: null,
      completionCostPerMillion: null,
    });
  });

  it('returns supported:false when the provider returns 404', async () => {
    mockFetch({ status: 404 });
    const svc = new AgentModelsService(makeRepo());
    const result = await svc.listForCurrentActor();
    expect(result.supported).toBe(false);
    expect(result.models).toEqual([]);
  });

  it('returns supported:false when the body is not the expected shape', async () => {
    mockFetch({ status: 200, body: { unexpected: 'shape' } });
    const svc = new AgentModelsService(makeRepo());
    const result = await svc.listForCurrentActor();
    expect(result.supported).toBe(false);
  });

  it('caches the response for the same (id, baseUrl) pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [{ id: 'm-1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AgentModelsService(makeRepo());
    await svc.listForCurrentActor();
    await svc.listForCurrentActor();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('strips trailing slashes from the base URL before appending /models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const repo = makeRepo({
      row: { ...baseRow, providerBaseUrl: 'https://provider.example/v1//' },
    });
    const svc = new AgentModelsService(repo);
    await svc.listForCurrentActor();
    const calledUrl: unknown = fetchMock.mock.calls[0]?.[0];
    expect(calledUrl).toBe('https://provider.example/v1/models');
  });

  it('uses Bearer auth for OAI-compat providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AgentModelsService(makeRepo({ apiKey: 'sk-or-test' }));
    await svc.listForCurrentActor();
    const call = fetchMock.mock.calls[0] as [unknown, { headers: Record<string, string> }];
    const init = call[1];
    expect(init.headers.authorization).toBe('Bearer sk-or-test');
    expect(init.headers['x-api-key']).toBeUndefined();
  });

  it('uses x-api-key + anthropic-version on api.anthropic.com', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const repo = makeRepo({
      apiKey: 'sk-ant-test',
      row: { ...baseRow, providerBaseUrl: 'https://api.anthropic.com/v1' },
    });
    const svc = new AgentModelsService(repo);
    await svc.listForCurrentActor();
    const call = fetchMock.mock.calls[0] as [unknown, { headers: Record<string, string> }];
    const init = call[1];
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers.authorization).toBeUndefined();
  });
});
