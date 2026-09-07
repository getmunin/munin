'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, LogOut, Menu, X } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@getmunin/ui';
import { api } from '../api';
import { authClient } from '../auth-client';
import { clearActiveOrgId, setActiveOrgId } from '../auth/active-org';
import {
  invalidateActiveMembershipCache,
  isOwnerOrAdmin,
  useActiveRole,
} from '../auth/use-active-role';
import { notify } from '../lib/notify';
import { Link, usePathname, useRouter } from '../i18n-navigation';
import { useRealtime, type RealtimeEventRow } from '../realtime';
import {
  consoleGroupsForRole,
  isConsoleItemActive,
  OSS_CONSOLE_GROUPS,
  type ConsoleBadge,
  type ConsoleNavGroup,
} from '../nav/console-groups';
import type { InboxQueueResponse } from '../components/dashboard/inbox-types';

interface MembershipRow {
  orgId: string;
  name: string;
  slug: string;
  role: string;
  isDefault: boolean;
}

interface RosterMember {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  activeClaimCount: number;
}

interface RosterResponse {
  members: RosterMember[];
  viewer: { userId: string; role: string } | null;
}

interface ConsoleBadges {
  waiting: number;
  queue: number;
  learning: number;
}

const EMPTY_BADGES: ConsoleBadges = { waiting: 0, queue: 0, learning: 0 };

const REFRESH_PREFIXES = [
  'conversation.',
  'kb.',
  'crm.merge_proposal.',
  'outreach.proposal.',
  'cms.entry.',
];

function initialsOf(name: string | null | undefined, fallback: string): string {
  const src = name?.trim() || fallback;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const two = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`;
  return (two || src.slice(0, 2)).toUpperCase();
}

function useConsoleData(): { badges: ConsoleBadges; roster: RosterMember[] } {
  const [badges, setBadges] = useState<ConsoleBadges>(EMPTY_BADGES);
  const [roster, setRoster] = useState<RosterMember[]>([]);

  const load = useCallback(() => {
    void api<InboxQueueResponse>('/v1/inbox')
      .then((res) =>
        setBadges({
          waiting:
            res.queue.crm.length +
            res.queue.outreach.length +
            res.queue.cms.length +
            (res.queue.feedback?.length ?? 0),
          queue: res.live.length,
          learning: res.queue.kb.length,
        }),
      )
      .catch(() => undefined);
    void api<RosterResponse>('/v1/orgs/me/roster')
      .then((res) => setRoster(res.members))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onEvent = useCallback(
    (event: RealtimeEventRow) => {
      if (REFRESH_PREFIXES.some((prefix) => event.type.startsWith(prefix))) load();
    },
    [load],
  );
  const subscriptions = useMemo(() => [{ channel: 'org' } as const], []);
  useRealtime(subscriptions, onEvent);

  return { badges, roster };
}

function badgeValue(badge: ConsoleBadge | undefined, badges: ConsoleBadges): number {
  if (badge === 'waiting') return badges.waiting;
  if (badge === 'queue') return badges.queue;
  if (badge === 'learning') return badges.learning;
  return 0;
}

function OrgSwitcher({ brand }: { brand: string }) {
  const t = useTranslations('dashboard.orgSwitcher');
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<MembershipRow[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const [activeOrgName, setActiveOrgName] = useState<string | null>(null);

  useEffect(() => {
    if (!open || orgs) return;
    void api<MembershipRow[]>('/v1/me/memberships')
      .then((rows) => {
        setOrgs(rows);
        setActiveOrgName((current) => current ?? rows.find((r) => r.name === brand)?.name ?? null);
      })
      .catch(() => notify.error(t('errors.load')));
  }, [open, orgs, brand, t]);

  const pick = (org: MembershipRow) => {
    if (switching) return;
    setSwitching(true);
    setActiveOrgId(org.orgId);
    invalidateActiveMembershipCache();
    window.location.reload();
  };

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-2 rounded-[4px] border border-transparent px-2.5 py-1.5 text-[13px] font-medium text-ink transition-colors duration-fast ease-munin hover:bg-paper-deep aria-expanded:border-rule-soft aria-expanded:bg-paper-deep dark:text-foreground dark:hover:bg-card dark:aria-expanded:border-rule-on-dark dark:aria-expanded:bg-card"
      >
        <span className="truncate">{brand}</span>
        <ChevronDown
          aria-hidden
          className={`size-3.5 shrink-0 transition-transform duration-base ease-munin ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-72 border border-ink bg-paper shadow-[0_12px_32px_-12px_rgba(15,20,25,0.18)] dark:border-rule-on-dark dark:bg-card">
            <div className="border-b border-rule-soft px-3.5 py-2.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-mute dark:border-rule-on-dark">
              {orgs ? `${t('yourOrgs')} · ${orgs.length}` : t('loading')}
            </div>
            {orgs?.map((org) => {
              const current = org.name === (activeOrgName ?? brand);
              return (
                <button
                  key={org.orgId}
                  type="button"
                  onClick={() => pick(org)}
                  className="flex w-full items-center gap-2.5 border-b border-rule-soft px-3.5 py-2.5 text-left transition-colors duration-fast ease-munin last:border-b-0 hover:bg-paper-deep dark:border-rule-on-dark dark:hover:bg-secondary"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-[4px] bg-cobalt font-serif text-xs leading-none text-paper">
                    {org.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] font-medium ${current ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink dark:text-foreground'}`}
                  >
                    {org.name}
                    {switching && current ? t('switching') : ''}
                  </span>
                  {current ? (
                    <Check aria-hidden className="size-4 shrink-0 text-cobalt dark:text-cobalt-soft" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NavList({
  groups,
  badges,
  onNavigate,
  mobile,
}: {
  groups: ConsoleNavGroup[];
  badges: ConsoleBadges;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const tNav = useTranslations('nav');
  const tGroups = useTranslations('dashboard.console.groups');
  const pathname = usePathname();

  return (
    <nav className={mobile ? 'flex flex-col gap-6' : 'flex flex-col gap-6 pl-2 pr-6'}>
      {groups.map((group) => (
        <div key={group.groupKey}>
          <p
            className={`mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute ${mobile ? '' : 'px-3.5'}`}
          >
            {tGroups(group.groupKey)}
          </p>
          <ul className={mobile ? '' : 'space-y-px'}>
            {group.items.map((item) => {
              const active = isConsoleItemActive(pathname, item.href);
              const count = badgeValue(item.badge, badges);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={
                      mobile
                        ? `flex min-h-[52px] items-center justify-between gap-3 border-b border-rule-soft text-base dark:border-rule-on-dark ${active ? 'text-cobalt dark:text-cobalt-soft' : 'text-ink dark:text-foreground'}`
                        : `flex items-center justify-between gap-2 border-l-[3px] px-3.5 py-2 text-[14.5px] transition-colors duration-fast ease-munin ${
                            active
                              ? 'border-cobalt bg-paper text-ink dark:border-cobalt-soft dark:bg-card dark:text-foreground'
                              : 'border-transparent text-ink-soft hover:text-ink dark:text-foreground/70 dark:hover:text-foreground'
                          }`
                    }
                  >
                    <span className="truncate">{tNav(item.labelKey)}</span>
                    {count > 0 ? (
                      <span className="font-mono text-[10px] text-cobalt dark:text-cobalt-soft">
                        {count}
                      </span>
                    ) : item.trailingArrow ? (
                      <span aria-hidden className="font-mono text-base leading-none text-ink-mute">
                        →
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function OnDutyCard({ roster, viewerUserId }: { roster: RosterMember[]; viewerUserId: string | null }) {
  const t = useTranslations('dashboard.console.onDuty');
  if (roster.length === 0) return null;
  return (
    <div className="mx-5 mb-5 flex flex-col gap-3 border border-rule-soft bg-paper p-3.5 dark:border-rule-on-dark dark:bg-card">
      <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute">
        {t('title')}
      </span>
      <div className="flex flex-col gap-2.5">
        {roster.slice(0, 5).map((member) => {
          const isYou = member.userId === viewerUserId;
          return (
            <span key={member.userId} className="flex items-center gap-2.5">
              <span
                className={`flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[8px] text-paper ${isYou ? 'bg-cobalt' : 'bg-ink dark:bg-foreground dark:text-background'}`}
              >
                {initialsOf(member.name, member.email)}
              </span>
              <span className="min-w-0 truncate text-[12.5px] text-ink-soft dark:text-foreground/80">
                {isYou ? t('you', { name: member.name ?? member.email }) : (member.name ?? member.email)}
              </span>
              <span className="ml-auto whitespace-nowrap font-mono text-[9px] uppercase tracking-meta text-ink-mute">
                {t('claimed', { count: member.activeClaimCount })}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export interface ConsoleShellProps {
  brand: string;
  logoSrc?: string;
  headSlot?: ReactNode;
  children: ReactNode;
}

export function ConsoleShell({ brand, logoSrc = '/munin-logo.png', headSlot, children }: ConsoleShellProps) {
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { role } = useActiveRole();
  const { badges, roster } = useConsoleData();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const groups = consoleGroupsForRole(OSS_CONSOLE_GROUPS, isOwnerOrAdmin(role));
  const activeItem = groups
    .flatMap((g) => g.items)
    .find((item) => isConsoleItemActive(pathname, item.href));
  const viewerUserId = session?.user?.id ?? null;

  const signOut = () => {
    void (async () => {
      await authClient.signOut();
      clearActiveOrgId();
      router.push('/login');
    })();
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col border-r border-ink bg-bone md:flex dark:border-rule-on-dark dark:bg-secondary">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <Image src={logoSrc} alt="" aria-hidden width={44} height={44} className="block size-11 object-contain" />
          <OrgSwitcher brand={brand} />
        </div>
        {headSlot}
        <div className="min-h-0 flex-1 overflow-y-auto py-3">
          <NavList groups={groups} badges={badges} />
        </div>
        <OnDutyCard roster={roster} viewerUserId={viewerUserId} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-ink px-4 md:hidden dark:border-rule-on-dark">
          <Image src={logoSrc} alt="" aria-hidden width={26} height={26} className="block size-[26px] object-contain" />
          <span className="min-w-0 truncate text-sm font-medium text-ink dark:text-foreground">
            {brand}
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={tNav('openMenu')}
            className="ml-auto flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-soft dark:text-foreground/80"
          >
            {activeItem ? <span>{tNav(activeItem.labelKey)}</span> : null}
            <Menu aria-hidden className="size-4 text-ink dark:text-foreground" />
          </button>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-paper dark:bg-background">
          {children}
        </main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-full max-w-none border-0 p-0 sm:max-w-none">
          <div className="flex h-full flex-col bg-paper dark:bg-background">
            <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-ink px-4 dark:border-rule-on-dark">
              <Image src={logoSrc} alt="" aria-hidden width={26} height={26} className="block size-[26px] object-contain" />
              <SheetTitle className="min-w-0 truncate text-sm font-medium text-ink dark:text-foreground">
                {brand}
              </SheetTitle>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={tNav('closeMenu')}
                className="ml-auto flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-eyebrow text-ink-soft dark:text-foreground/80"
              >
                {tCommon('close')}
                <X aria-hidden className="size-4 text-ink dark:text-foreground" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              <NavList groups={groups} badges={badges} mobile onNavigate={() => setMenuOpen(false)} />
            </div>
            <div className="flex shrink-0 items-center gap-2.5 border-t border-rule-soft px-4 py-3.5 dark:border-rule-on-dark">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cobalt font-mono text-[8px] text-paper">
                {initialsOf(session?.user?.name ?? null, session?.user?.email ?? '?')}
              </span>
              <span className="min-w-0 truncate text-[15px] text-ink dark:text-foreground">
                {session?.user?.name ?? session?.user?.email}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="ml-auto flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-meta text-ink-mute transition-colors duration-fast hover:text-ink dark:hover:text-foreground"
              >
                <LogOut aria-hidden className="size-3.5" />
                {tCommon('signOut')}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
