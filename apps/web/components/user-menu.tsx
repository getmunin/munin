'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { authClient } from '@getmunin/dashboard-pages';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
} from '@getmunin/ui';

interface UserMenuProps {
  email: string;
  name: string;
  image: string | null;
  signOutLabel: string;
  onSignOut: () => void;
}

export function UserMenu({ email, name, image, signOutLabel, onSignOut }: UserMenuProps) {
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
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-8 gap-2 px-1.5" />}>
          <Avatar className="size-7">
            {image && <AvatarImage src={image} alt={name} />}
            <AvatarFallback>{initials || '?'}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => setEditOpen(true)}
              className="flex-col items-start gap-0.5 py-2"
              aria-label={tProfile('editAria')}
            >
              <span className="text-sm font-medium normal-case tracking-normal">{name}</span>
              <span className="text-xs text-ink-mute normal-case tracking-normal">{email}</span>
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
