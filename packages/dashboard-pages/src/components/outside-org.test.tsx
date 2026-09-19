import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { OutsideOrg } from './outside-org';

vi.mock('../auth/use-active-role', () => ({
  useDefaultMembership: () => ({
    membership: { orgId: 'org_0123456789abcdefghijkl', name: 'Acme', slug: 'acme', role: 'owner', isDefault: true },
    loading: false,
    error: null,
  }),
}));

vi.mock('../i18n-navigation', () => ({
  Link: ({ href, ...rest }: { href: string } & React.ComponentProps<'a'>) => (
    <a href={href} {...rest} />
  ),
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
});
