import { describe, it, expect, beforeEach } from 'vitest';
import { isSetupIncomplete, type MembershipDto } from './setup-status';
import { clearActiveOrgId, getActiveOrgId, setActiveOrgId } from './active-org';

function installSessionStorage(): void {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => void entries.set(key, value),
        removeItem: (key: string) => void entries.delete(key),
      },
    },
    configurable: true,
    writable: true,
  });
}

const ONBOARDING: MembershipDto = {
  orgId: 'org_onboarding',
  name: '',
  role: 'owner',
  isDefault: true,
};
const ESTABLISHED: MembershipDto = {
  orgId: 'org_established',
  name: 'Acme',
  role: 'owner',
  isDefault: false,
};

const ROWS = [ESTABLISHED, ONBOARDING];
const CONFIGURED = { providerConfigured: true };

function selectPinned(rows: MembershipDto[]): MembershipDto | null {
  const pinned = getActiveOrgId();
  return (
    (pinned ? rows.find((m) => m.orgId === pinned) : undefined) ??
    rows.find((m) => m.isDefault) ??
    rows[0] ??
    null
  );
}

function selectDefault(rows: MembershipDto[]): MembershipDto | null {
  return rows.find((m) => m.isDefault) ?? rows[0] ?? null;
}

describe('setup gate org resolution', () => {
  beforeEach(() => {
    installSessionStorage();
    clearActiveOrgId();
  });

  it('agrees with the server when a stale pin points at a different org', () => {
    setActiveOrgId(ESTABLISHED.orgId);

    const serverSaysIncomplete = isSetupIncomplete(CONFIGURED, ROWS);
    const clientSees = selectDefault(ROWS);
    const clientSaysIncomplete = clientSees!.name.trim().length === 0;

    expect(serverSaysIncomplete).toBe(true);
    expect(clientSaysIncomplete).toBe(true);
  });

  it('is the pinned selection that disagreed, which is what wedged the gate', () => {
    setActiveOrgId(ESTABLISHED.orgId);

    const pinned = selectPinned(ROWS);
    expect(pinned!.orgId).toBe(ESTABLISHED.orgId);
    expect(pinned!.name.trim().length === 0).toBe(false);
    expect(isSetupIncomplete(CONFIGURED, ROWS)).toBe(true);
  });

  it('resolves the default org with no pin set', () => {
    expect(selectDefault(ROWS)!.orgId).toBe(ONBOARDING.orgId);
  });

  it('still resolves the default org when the pin already matches it', () => {
    setActiveOrgId(ONBOARDING.orgId);
    expect(selectDefault(ROWS)!.orgId).toBe(ONBOARDING.orgId);
  });

  it('leaves the pin alone once the org being onboarded has a name', () => {
    const named = [{ ...ONBOARDING, name: 'Acme Two' }, ESTABLISHED];
    expect(isSetupIncomplete(CONFIGURED, named)).toBe(false);
  });

  it('falls back to the first row when no membership is marked default', () => {
    const none = ROWS.map((m) => ({ ...m, isDefault: false }));
    expect(selectDefault(none)!.orgId).toBe(ESTABLISHED.orgId);
  });
});
