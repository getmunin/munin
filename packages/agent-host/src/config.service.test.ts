import { describe, expect, it, vi } from 'vitest';
import { AgentConfigService } from './config.service.js';
import type {
  AgentConfigPatch,
  AgentConfigRepository,
  AgentConfigRow,
} from './config.repository.js';
import type { AdminKeyProvider } from './admin-key-provider.js';

const baseRow: AgentConfigRow = {
  id: 'singleton',
  chatModel: 'anthropic/claude-haiku-4.5',
  curatorModel: null,
  providerBaseUrl: 'https://provider.example/v1',
  providerApiKeySet: false,
  maxHistoryChars: 32_000,
  maxToolIterations: 8,
  debounceMs: 500,
  adminApiKeyId: null,
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
    read: vi.fn().mockResolvedValue(opts.before),
    update,
    listProvisionedIds: vi.fn().mockResolvedValue([]),
    readDecryptedProviderKey: vi.fn().mockResolvedValue(null),
    readDecryptedAdminKey: vi.fn().mockResolvedValue(null),
  };
}

function makeAdminKey(): AdminKeyProvider & {
  mint: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
} {
  return {
    mint: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AgentConfigService', () => {
  it('reads + serialises the row into a DTO with ISO timestamps', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const svc = new AgentConfigService(repo, makeAdminKey());
    const dto = await svc.getForCurrentActor();
    expect(dto.id).toBe('singleton');
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('mints an admin key when a provider key is first set', async () => {
    const after: AgentConfigRow = { ...baseRow, providerApiKeySet: true };
    const repo = makeRepo({ before: baseRow, after });
    const adminKey = makeAdminKey();
    const svc = new AgentConfigService(repo, adminKey);

    await svc.upsertForCurrentActor({ providerApiKey: 'sk-test' });

    expect(adminKey.mint).toHaveBeenCalledWith('singleton');
    expect(adminKey.revoke).not.toHaveBeenCalled();
  });

  it('does NOT mint when adding a provider key but admin key already exists', async () => {
    const before: AgentConfigRow = { ...baseRow, adminApiKeyId: 'ak_existing' };
    const after: AgentConfigRow = { ...before, providerApiKeySet: true };
    const repo = makeRepo({ before, after });
    const adminKey = makeAdminKey();
    const svc = new AgentConfigService(repo, adminKey);

    await svc.upsertForCurrentActor({ providerApiKey: 'sk-test' });

    expect(adminKey.mint).not.toHaveBeenCalled();
    expect(adminKey.revoke).not.toHaveBeenCalled();
  });

  it('revokes the admin key when the provider key is cleared', async () => {
    const before: AgentConfigRow = {
      ...baseRow,
      providerApiKeySet: true,
      adminApiKeyId: 'ak_to_revoke',
    };
    const after: AgentConfigRow = { ...before, providerApiKeySet: false };
    const repo = makeRepo({ before, after });
    const adminKey = makeAdminKey();
    const svc = new AgentConfigService(repo, adminKey);

    await svc.upsertForCurrentActor({ providerApiKey: null });

    expect(adminKey.revoke).toHaveBeenCalledWith('singleton', 'ak_to_revoke');
    expect(adminKey.mint).not.toHaveBeenCalled();
  });

  it('skips mint/revoke when patches do not change provider-key presence', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const adminKey = makeAdminKey();
    const svc = new AgentConfigService(repo, adminKey);

    await svc.upsertForCurrentActor({ chatModel: 'anthropic/claude-sonnet-4-6' });

    expect(adminKey.mint).not.toHaveBeenCalled();
    expect(adminKey.revoke).not.toHaveBeenCalled();
  });

  it('passes the patch through to the repo verbatim', async () => {
    const repo = makeRepo({ before: baseRow, after: baseRow });
    const svc = new AgentConfigService(repo, makeAdminKey());

    const patch: AgentConfigPatch = {
      chatModel: 'a',
      curatorModel: 'b',
      providerBaseUrl: 'https://x',
      maxHistoryChars: 64_000,
    };
    await svc.upsertForCurrentActor(patch);

    expect(repo.update).toHaveBeenCalledWith('singleton', patch);
  });
});
