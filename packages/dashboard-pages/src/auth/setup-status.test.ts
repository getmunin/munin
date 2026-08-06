import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isSetupIncomplete,
  resolvePostAuthDestination,
  type MembershipDto,
} from './setup-status';
import { api } from '../api';

vi.mock('../api', () => ({ api: vi.fn() }));

const apiMock = vi.mocked(api);

function membership(overrides: Partial<MembershipDto> = {}): MembershipDto {
  return { orgId: 'org_1', name: 'Acme', role: 'owner', isDefault: true, ...overrides };
}

function respondWith(
  config: { providerConfigured: boolean } | Error,
  memberships: MembershipDto[] | Error,
): void {
  apiMock.mockImplementation((path: string) => {
    if (path === '/v1/agent-config') {
      return config instanceof Error ? Promise.reject(config) : Promise.resolve(config);
    }
    if (path === '/v1/me/memberships') {
      return memberships instanceof Error
        ? Promise.reject(memberships)
        : Promise.resolve(memberships);
    }
    throw new Error(`unexpected path ${path}`);
  });
}

describe('isSetupIncomplete', () => {
  it('is true for an owner whose org has no name', () => {
    expect(isSetupIncomplete({ providerConfigured: true }, [membership({ name: '' })])).toBe(true);
    expect(isSetupIncomplete({ providerConfigured: true }, [membership({ name: '  ' })])).toBe(true);
  });

  it('is true for an owner with no LLM provider configured', () => {
    expect(isSetupIncomplete({ providerConfigured: false }, [membership()])).toBe(true);
  });

  it('is true for an admin, not just an owner', () => {
    expect(
      isSetupIncomplete({ providerConfigured: true }, [membership({ role: 'admin', name: '' })]),
    ).toBe(true);
  });

  it('is false once the org is named and a provider is configured', () => {
    expect(isSetupIncomplete({ providerConfigured: true }, [membership()])).toBe(false);
  });

  it('never diverts a non-admin member', () => {
    expect(
      isSetupIncomplete({ providerConfigured: false }, [membership({ role: 'member', name: '' })]),
    ).toBe(false);
  });

  it('falls through when either read failed or returned nothing', () => {
    expect(isSetupIncomplete(null, [membership({ name: '' })])).toBe(false);
    expect(isSetupIncomplete({ providerConfigured: false }, null)).toBe(false);
    expect(isSetupIncomplete({ providerConfigured: false }, [])).toBe(false);
  });

  it('reads the default membership rather than the first row', () => {
    expect(
      isSetupIncomplete({ providerConfigured: true }, [
        membership({ orgId: 'org_other', name: 'Named', isDefault: false }),
        membership({ orgId: 'org_active', name: '', isDefault: true }),
      ]),
    ).toBe(true);
  });
});

describe('resolvePostAuthDestination', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('sends a fresh owner to onboarding', async () => {
    respondWith({ providerConfigured: false }, [membership({ name: '' })]);
    await expect(resolvePostAuthDestination('/dashboard')).resolves.toBe('/setup');
  });

  it('sends a set-up owner to the fallback', async () => {
    respondWith({ providerConfigured: true }, [membership()]);
    await expect(resolvePostAuthDestination('/dashboard')).resolves.toBe('/dashboard');
  });

  it('keeps a non-default fallback when setup is complete', async () => {
    respondWith({ providerConfigured: true }, [membership()]);
    await expect(resolvePostAuthDestination('/dashboard/settings')).resolves.toBe(
      '/dashboard/settings',
    );
  });

  it('falls back when the agent-config read fails', async () => {
    respondWith(new Error('boom'), [membership({ name: '' })]);
    await expect(resolvePostAuthDestination('/dashboard')).resolves.toBe('/dashboard');
  });

  it('falls back when the memberships read fails', async () => {
    respondWith({ providerConfigured: false }, new Error('boom'));
    await expect(resolvePostAuthDestination('/dashboard')).resolves.toBe('/dashboard');
  });
});
