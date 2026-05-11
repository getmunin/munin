'use client';

import { useTranslations } from 'next-intl';
import {
  authClient,
  ConfirmDialogProvider,
  isOwnerOrAdmin,
  MuninTopbar,
  type MuninTopbarNavItem,
  useActiveMembership,
  useDashboardGate,
  useRealtime,
  type SubscriptionChannel,
} from '@getmunin/dashboard-pages';
import { PageSpinner } from '@getmunin/ui';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { UserMenu } from '@/components/user-menu';
import { SETTINGS_GROUPS } from './nav-config';

const ORG_SUBSCRIPTIONS: readonly SubscriptionChannel[] = [{ channel: 'org' }];
const noopEvent = () => undefined;

type NavLabelKey = 'overview' | 'settings';

interface NavConfig {
  href: string;
  labelKey: NavLabelKey;
  exact?: boolean;
  ownerOrAdminOnly?: boolean;
}

const NAV: NavConfig[] = [
  { href: '/dashboard', labelKey: 'overview', exact: true },
  { href: '/dashboard/settings', labelKey: 'settings', ownerOrAdminOnly: true },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('dashboard.status');
  const tGroups = useTranslations('dashboard.settings.groups');
  const { data: session } = authClient.useSession();
  const { ready, role } = useDashboardGate();
  const { membership } = useActiveMembership();
  const { status } = useRealtime(ORG_SUBSCRIPTIONS, noopEvent);

  if (!ready || !session) {
    return <PageSpinner className="min-h-screen bg-bone dark:bg-background" />;
  }

  const navItems: MuninTopbarNavItem[] = NAV.filter(
    (item) => !item.ownerOrAdminOnly || isOwnerOrAdmin(role),
  ).map((item) => ({
    href: item.href,
    label: tNav(item.labelKey),
    exact: item.exact,
    mobileSubNav:
      item.labelKey === 'settings' ? (
        <div className="space-y-4 px-2 py-3">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.groupKey}>
              <p className="px-4 pb-1 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
                {tGroups(group.groupKey)}
              </p>
              <ul>
                {group.items.map((sub) => {
                  const active = pathname.startsWith(sub.href);
                  return (
                    <li key={sub.href}>
                      <Link
                        href={sub.href}
                        aria-current={active ? 'page' : undefined}
                        className={
                          active
                            ? 'block border-l-2 border-cobalt bg-paper px-4 py-2 text-sm font-medium text-ink dark:border-cobalt-soft dark:bg-card dark:text-foreground'
                            : 'block border-l-2 border-transparent px-4 py-2 text-sm text-ink-soft hover:bg-paper hover:text-ink dark:hover:bg-card dark:hover:text-foreground'
                        }
                      >
                        {tNav(sub.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : undefined,
  }));

  return (
    <ConfirmDialogProvider>
      <div className="flex min-h-screen flex-col bg-bone dark:bg-background">
        <MuninTopbar
          brand={membership?.name?.trim() || 'Munin'}
          logoSrc="/munin-logo.png"
          navItems={navItems}
          status={{ value: status, label: tStatus(status) }}
          mobileMenuLabels={{
            open: tNav('openMenu'),
            close: tNav('closeMenu'),
            organization: tNav('organization'),
          }}
          rightSlot={
            <UserMenu
              email={session.user.email}
              name={session.user.name ?? session.user.email}
              image={session.user.image ?? null}
              signOutLabel={tCommon('signOut')}
              onSignOut={() => {
                void (async () => {
                  await authClient.signOut();
                  router.push('/login');
                })();
              }}
            />
          }
        />
        <main className="flex-1 bg-paper dark:bg-background">{children}</main>
      </div>
    </ConfirmDialogProvider>
  );
}
