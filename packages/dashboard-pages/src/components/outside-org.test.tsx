import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { OutsideOrg } from './outside-org';

vi.mock('../auth/use-active-role', () => ({
  useDefaultMembership: () => ({
    membership: { orgId: 'org_0123456789abcdefghijkl', name: 'Acme', slug: 'acme', role: 'owner', isDefault: true },
    loading: false,
    error: null,
  }),
}));

const push = vi.fn();
const signOut = vi.fn(() => Promise.resolve());

vi.mock('../i18n-navigation', () => ({
  Link: ({ href, ...rest }: { href: string } & React.ComponentProps<'a'>) => (
    <a href={href} {...rest} />
  ),
  useRouter: () => ({ push }),
  useScopedPathname: () => '/o/org_zyxwvutsrqponmlkjihgf/dashboard/inbox',
}));

vi.mock('../auth-client', () => ({
  authClient: { signOut: () => signOut() },
}));

const OTHER = 'org_zyxwvutsrqponmlkjihgf';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OutsideOrg', () => {
  it('resolves every message key against the real bundle', () => {
    renderWithProviders(<OutsideOrg orgId={OTHER} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'This belongs to another workspace.',
    );
    expect(screen.getByText(/not a member of/)).toBeTruthy();
  });

  it('names the org the link pointed at, so the operator can ask for the right invite', () => {
    renderWithProviders(<OutsideOrg orgId={OTHER} />);
    expect(screen.getByText(OTHER)).toBeTruthy();
  });

  it('offers a way back into an org the viewer does belong to', () => {
    renderWithProviders(<OutsideOrg orgId={OTHER} />);
    const link = screen.getByRole('button', { name: 'Open Acme' });
    expect(link.getAttribute('href')).toBe('/o/org_0123456789abcdefghijkl/dashboard');
  });

  it('signs out and returns to the same link after signing in with another account', async () => {
    renderWithProviders(<OutsideOrg orgId={OTHER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with another account' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/login?redirect=${encodeURIComponent('/o/org_zyxwvutsrqponmlkjihgf/dashboard/inbox')}`,
      ),
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]!);
  });
});
