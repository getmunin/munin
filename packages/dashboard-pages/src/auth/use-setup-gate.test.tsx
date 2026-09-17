import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const push = vi.fn();
const memberships = vi.fn<() => Promise<unknown[]>>();

vi.mock('../i18n-navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'usr_1' } }, isPending: false }) },
}));
vi.mock('./use-agent-config-status', () => ({
  useAgentConfigStatus: () => ({ configured: true, loading: false }),
}));
vi.mock('./dashboard-bootstrap', () => ({ useDashboardBootstrap: () => null }));
vi.mock('../api', () => ({ api: (): Promise<unknown[]> => memberships() }));

const { getActiveOrgId, setActiveOrgId, clearActiveOrgId } = await import('./active-org');
const { useSetupGate } = await import('./use-setup-gate');
const { invalidateActiveMembershipCache } = await import('./use-active-role');

const ONBOARDING = { orgId: 'org_new', name: '', slug: 'new', role: 'owner', isDefault: true };
const ESTABLISHED = {
  orgId: 'org_old',
  name: 'Acme',
  slug: 'acme',
  role: 'owner',
  isDefault: false,
};

function Probe() {
  const { ready } = useSetupGate();
  return <span data-testid="ready">{String(ready)}</span>;
}

async function renderProbe() {
  await act(() => {
    render(<Probe />);
    return Promise.resolve();
  });
}

describe('useSetupGate with a pinned org', () => {
  beforeEach(() => {
    push.mockClear();
    clearActiveOrgId();
    invalidateActiveMembershipCache();
    memberships.mockResolvedValue([ESTABLISHED, ONBOARDING]);
  });

  afterEach(() => {
    clearActiveOrgId();
    invalidateActiveMembershipCache();
  });

  it('renders the wizard even when a stale pin points at an established org', async () => {
    setActiveOrgId(ESTABLISHED.orgId);
    await renderProbe();
    expect(screen.getByTestId('ready').textContent).toBe('true');
    expect(push).not.toHaveBeenCalled();
  });

  it('repoints the pin at the org being onboarded, so the wizard writes to the right one', async () => {
    setActiveOrgId(ESTABLISHED.orgId);
    await renderProbe();
    expect(getActiveOrgId()).toBe(ONBOARDING.orgId);
  });

  it('renders the wizard with no pin at all', async () => {
    await renderProbe();
    expect(screen.getByTestId('ready').textContent).toBe('true');
  });

  it('leaves for the dashboard once the default org has a name', async () => {
    memberships.mockResolvedValue([ESTABLISHED, { ...ONBOARDING, name: 'Acme Two' }]);
    await renderProbe();
    expect(screen.getByTestId('ready').textContent).toBe('false');
    expect(push).toHaveBeenCalledWith('/dashboard');
  });

  it('does not touch a pin that already matches the org being onboarded', async () => {
    setActiveOrgId(ONBOARDING.orgId);
    await renderProbe();
    expect(getActiveOrgId()).toBe(ONBOARDING.orgId);
  });
});
