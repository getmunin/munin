'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ClipboardCheck,
  Loader2,
  LogOut,
  MessageCircle,
  Newspaper,
  Settings,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { authClient, isOwnerOrAdmin, useActiveRole } from '@getmunin/dashboard-pages';
import { Button } from '@getmunin/ui';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@getmunin/ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@getmunin/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@getmunin/ui';
import { Input } from '@getmunin/ui';
import { Label } from '@getmunin/ui';
import { cn } from '@getmunin/ui';
import { LocaleSwitcher } from '@/components/locale-switcher';

type NavLabelKey = 'conversations' | 'activity' | 'review' | 'settings';

interface NavItem {
  href: Route;
  labelKey: NavLabelKey;
  icon: React.ComponentType<{ className?: string }>;
  ownerOrAdminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: '/dashboard/conversations', labelKey: 'conversations', icon: MessageCircle },
  { href: '/dashboard/activity', labelKey: 'activity', icon: Newspaper },
  { href: '/dashboard/review', labelKey: 'review', icon: ClipboardCheck },
  { href: '/dashboard/settings', labelKey: 'settings', icon: Settings, ownerOrAdminOnly: true },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const { data: session, isPending } = authClient.useSession();
  const { role } = useActiveRole();
  const visibleNav = NAV.filter((item) => !item.ownerOrAdminOnly || isOwnerOrAdmin(role));

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={tCommon('loading')} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            Munin
          </Link>
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
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
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
        <nav className="hidden w-56 shrink-0 md:block">
          <ul className="space-y-1">
            {visibleNav.map((item) => {
              const active = pathname.startsWith(item.href);
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
                    {tNav(item.labelKey)}
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
  signOutLabel: string;
  onSignOut: () => void;
}

function UserMenu({ email, name, image, signOutLabel, onSignOut }: UserMenuProps) {
  const tProfile = useTranslations('dashboard.profile');
  const [editOpen, setEditOpen] = useState(false);
  const initials = name
    .split(' ')
    .map((part) => part[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
  return (
    <>
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
            <DropdownMenuItem
              onClick={() => setEditOpen(true)}
              className="flex-col items-start gap-0.5 py-1.5"
              aria-label={tProfile('editAria')}
            >
              <span className="text-sm font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">{email}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSignOut}>
            <LogOut className="size-4" />
            {signOutLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditProfileDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initialName={name}
        email={email}
      />
    </>
  );
}

interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  email: string;
}

function EditProfileDialog({ open, onOpenChange, initialName, email }: EditProfileDialogProps) {
  const t = useTranslations('dashboard.profile');
  const tCommon = useTranslations('common');
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setError(null);
      setSubmitting(false);
    }
  }, [open, initialName]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialName) {
      onOpenChange(false);
      return;
    }
    setSubmitting(true);
    setError(null);
    void (async () => {
      try {
        const result = await authClient.updateUser({ name: trimmed });
        if (result?.error) throw new Error(result.error.message ?? tCommon('unknownError'));
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : tCommon('unknownError'));
      } finally {
        setSubmitting(false);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">{t('nameLabel')}</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-email">{t('emailLabel')}</Label>
            <Input id="profile-email" value={email} readOnly disabled />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? t('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
