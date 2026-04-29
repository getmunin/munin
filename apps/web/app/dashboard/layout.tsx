'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import {
  Activity,
  Bot,
  Download,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  ScrollText,
  Users,
  UsersRound,
} from 'lucide-react';
import { authClient } from '@getmunin/dashboard-pages';
import { Button } from '@getmunin/ui';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@getmunin/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@getmunin/ui';
import { cn } from '@getmunin/ui';

type NavItem = { href: Route; label: string; icon: React.ComponentType<{ className?: string }> };

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/team', label: 'Team', icon: UsersRound },
  { href: '/dashboard/agents', label: 'Connected agents', icon: Bot },
  { href: '/dashboard/api-keys', label: 'API keys', icon: KeyRound },
  { href: '/dashboard/end-users', label: 'End-users', icon: Users },
  { href: '/dashboard/suggestions', label: 'Suggestions', icon: Lightbulb },
  { href: '/dashboard/usage', label: 'Usage', icon: Activity },
  { href: '/dashboard/audit-log', label: 'Audit log', icon: ScrollText },
  { href: '/dashboard/export', label: 'Data export', icon: Download },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) {
    return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            Munin
          </Link>
          <UserMenu
            email={session.user.email}
            name={session.user.name ?? session.user.email}
            image={session.user.image ?? null}
            onSignOut={() => {
              void (async () => {
                await authClient.signOut();
                router.push('/login');
              })();
            }}
          />
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
        <nav className="hidden w-56 shrink-0 md:block">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active =
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="flex-1 min-w-0 space-y-6">{children}</main>
      </div>
    </div>
  );
}

interface UserMenuProps {
  email: string;
  name: string;
  image: string | null;
  onSignOut: () => void;
}

function UserMenu({ email, name, image, onSignOut }: UserMenuProps) {
  const initials = name
    .split(' ')
    .map((part) => part[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 gap-2 px-2" />}>
        <Avatar className="size-7">
          {image && <AvatarImage src={image} alt={name} />}
          <AvatarFallback>{initials || '?'}</AvatarFallback>
        </Avatar>
        <span className="hidden text-sm font-medium sm:inline">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <span className="text-sm font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">{email}</span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
