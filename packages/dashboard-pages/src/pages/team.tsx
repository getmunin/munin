'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { api } from '../api';
import { authClient } from '../auth-client';
import { useActiveRole, isOwnerOrAdmin } from '../auth/use-active-role';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { TableSkeleton } from '../components/skeleton';
import { EmptyCallout } from '../components/empty-callout';
import { useConfirm } from '../components/confirm-dialog';
import { CopyableSecret } from '../components/copyable-secret';
import { NativeSelect } from '../components/native-select';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import { notify } from '../lib/notify';
import {
  dialogButtonClass,
  dialogFooterClass,
  dialogHintClass,
  dialogLabelClass,
} from '../lib/dialog-style';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Hero,
  Input,
  Label,
  SectionHead,
  cn,
} from '@getmunin/ui';

type MemberRole = 'owner' | 'admin' | 'member';

interface MemberDto {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  isDefault: boolean;
  joinedAt: string;
}

interface InvitationDto {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

interface CreatedInvitationDto extends InvitationDto {
  token: string;
  acceptUrl: string;
  mailerConfigured: boolean;
}

interface PendingShare {
  email: string;
  acceptUrl: string;
}

export function TeamPage() {
  const t = useTranslations('dashboard.team');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const format = useFormatter();
  const now = useNow();
  const confirm = useConfirm();
  const { data: session } = authClient.useSession();
  const { role: actorRole } = useActiveRole();
  const currentUserId = session?.user.id ?? null;
  const canEditAnyone = isOwnerOrAdmin(actorRole);
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [invites, setInvites] = useState<InvitationDto[] | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<MemberDto | null>(null);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      api<MemberDto[]>('/v1/orgs/me/members'),
      api<InvitationDto[]>('/v1/orgs/me/invitations'),
    ]);
    setMembers(m);
    setInvites(i);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  async function submitInvite(email: string, role: MemberRole) {
    const created = await api<CreatedInvitationDto>('/v1/orgs/me/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), role }),
    });
    if (!created.mailerConfigured) {
      setPendingShare({ email: created.email, acceptUrl: created.acceptUrl });
    } else {
      setPendingShare(null);
    }
    await tryLoad();
  }

  async function revokeInvite(invite: InvitationDto) {
    const ok = await confirm({
      title: t('revokeInviteConfirmTitle'),
      message: t('revokeInviteConfirm', { email: invite.email }),
      confirmLabel: tCommon('revoke'),
      cancelLabel: tCommon('cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/orgs/me/invitations/${invite.id}`, { method: 'DELETE' });
      await tryLoad();
    } catch (err) {
      notify.error(translate(err) || t('errors.revokeInvite'));
    }
  }

  async function removeMember(userId: string) {
    const ok = await confirm({
      title: t('removeConfirmTitle'),
      message: t('removeConfirm'),
      confirmLabel: t('remove'),
      cancelLabel: tCommon('cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/orgs/me/members/${userId}`, { method: 'DELETE' });
      await tryLoad();
    } catch (err) {
      notify.error(translate(err) || t('errors.remove'));
    }
  }

  async function changeRole(userId: string, role: MemberRole) {
    try {
      await api(`/v1/orgs/me/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await tryLoad();
    } catch (err) {
      notify.error(translate(err) || t('errors.changeRole'));
    }
  }

  async function renameMember(userId: string, name: string) {
    await api<MemberDto>(`/v1/orgs/me/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    await tryLoad();
  }

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('team', loadError, () => void retry(), retrying)}
      />
    );
  }

  return (
    <>
      <Hero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('subtitle')}
      />

      <section className="space-y-4">
        <SectionHead
          title={members ? t('membersTitleCount', { count: members.length }) : t('membersTitle')}
          actions={
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              {t('inviteTitle')}
            </Button>
          }
          divider={false}
        />
        {members === null ? (
          <TableSkeleton
            columns={[
              { grow: 3, bar: 'w-2/3' },
              { grow: 3, bar: 'w-3/4' },
              { grow: 2, bar: 'w-20' },
              { grow: 2, bar: 'w-1/2' },
              { grow: 2, bar: 'w-16', right: true },
            ]}
          />
        ) : (
          <div className="-mx-6 overflow-x-auto px-6 md:mx-0 md:px-0">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b-[1px] border-rule-soft dark:border-rule-on-dark text-left">
                <Th>{t('membersTableName')}</Th>
                <Th>{t('membersTableEmail')}</Th>
                <Th>{t('membersTableRole')}</Th>
                <Th>{t('membersTableJoined')}</Th>
                <Th className="text-right" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-b-[1px] border-rule-soft dark:border-rule-on-dark">
                  <td className="py-4 pr-4 text-sm font-medium text-ink dark:text-foreground">
                    {m.name ?? '—'}
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs text-ink-mute">{m.email}</td>
                  <td className="py-4 pr-4">
                    <RoleSelect
                      value={m.role as MemberRole}
                      onChange={(role) => void changeRole(m.userId, role)}
                      labelOwner={t('roleOwner')}
                      labelAdmin={t('roleAdmin')}
                      labelMember={t('roleMember')}
                    />
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs text-ink-mute">
                    {format.dateTime(new Date(m.joinedAt), { month: 'short', year: 'numeric' })}
                  </td>
                  <td className="py-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      {(canEditAnyone || m.userId === currentUserId) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(m)}
                        >
                          {tCommon('edit')}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void removeMember(m.userId)}>
                        {t('remove')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHead
          title={invites ? t('invitesTitleCount', { count: invites.length }) : t('invitesTitle')}
          divider={false}
        />
        {invites === null ? (
          <TableSkeleton
            columns={[
              { grow: 3, bar: 'w-3/4' },
              { grow: 2, bar: 'w-20' },
              { grow: 2, bar: 'w-1/2' },
              { grow: 2, bar: 'w-1/2' },
              { grow: 1, bar: 'w-12', right: true },
            ]}
          />
        ) : invites.length === 0 ? (
          <EmptyCallout title={t('invitesEmptyTitle')} body={t('invitesEmptyBody')} />
        ) : (
          <div className="-mx-6 overflow-x-auto px-6 md:mx-0 md:px-0">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b-[1px] border-rule-soft dark:border-rule-on-dark text-left">
                <Th>{t('invitesTable.email')}</Th>
                <Th>{t('invitesTable.role')}</Th>
                <Th>{t('invitesTable.sent')}</Th>
                <Th>{t('invitesTable.expires')}</Th>
                <Th className="text-right" />
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id} className="border-b-[1px] border-rule-soft dark:border-rule-on-dark">
                  <td className="py-4 pr-4 font-mono text-xs text-ink dark:text-foreground">
                    {inv.email}
                  </td>
                  <td className="py-4 pr-4">
                    <RoleChip role={inv.role as MemberRole} t={t} />
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs text-ink-mute">
                    {format.relativeTime(new Date(inv.createdAt), now)}
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs text-ink-mute">
                    {format.relativeTime(new Date(inv.expiresAt), now)}
                  </td>
                  <td className="py-4 text-right">
                    <Button variant="outline" size="sm" onClick={() => void revokeInvite(inv)}>
                      {tCommon('revoke')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <InviteTeammateDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSubmit={submitInvite}
      />

      <EditMemberDialog
        member={editing}
        isSelf={editing?.userId === currentUserId}
        onClose={() => setEditing(null)}
        onSubmit={renameMember}
      />

      <Dialog
        open={pendingShare !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingShare(null);
          }
        }}
      >
        <DialogContent>
          {pendingShare && (
            <>
              <DialogHeader>
                <DialogTitle>{t('manualShareTitle')}</DialogTitle>
                <DialogDescription>
                  {t.rich('manualShareBody', {
                    code: (chunks) => (
                      <code className="bg-paper-deep dark:bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-ink dark:text-foreground">
                        {chunks}
                      </code>
                    ),
                  })}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-2">
                <CopyableSecret
                  label={t('manualShareLinkLabel')}
                  value={pendingShare.acceptUrl}
                  hint={t('manualShareValid')}
                />
              </div>
              <DialogFooter className={dialogFooterClass}>
                <Button
                  variant="accent"
                  className={dialogButtonClass}
                  onClick={() => setPendingShare(null)}
                >
                  {tCommon('gotIt')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'pb-3 pr-4 font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute font-normal',
        className,
      )}
    >
      {children}
    </th>
  );
}

function RoleSelect({
  value,
  onChange,
  labelOwner,
  labelAdmin,
  labelMember,
}: {
  value: MemberRole;
  onChange: (role: MemberRole) => void;
  labelOwner: string;
  labelAdmin: string;
  labelMember: string;
}) {
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MemberRole)}
        className="appearance-none border-[1px] border-rule-soft dark:border-rule-on-dark focus-visible:border-cobalt bg-paper dark:bg-card font-mono text-[10px] uppercase tracking-eyebrow text-ink dark:text-foreground py-1.5 pl-3 pr-7 cursor-pointer focus-visible:outline-none"
      >
        <option value="owner">{labelOwner}</option>
        <option value="admin">{labelAdmin}</option>
        <option value="member">{labelMember}</option>
      </select>
      <ChevronDown
        aria-hidden
        className="absolute right-1.5 top-1/2 -translate-y-1/2 size-3 pointer-events-none text-ink-mute"
      />
    </div>
  );
}

function RoleChip({
  role,
  t,
}: {
  role: MemberRole;
  t: ReturnType<typeof useTranslations<'dashboard.team'>>;
}) {
  const label = role === 'owner' ? t('roleOwner') : role === 'admin' ? t('roleAdmin') : t('roleMember');
  return (
    <span className="inline-block border-[1px] border-rule-soft dark:border-rule-on-dark font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute py-1 px-2.5">
      {label}
    </span>
  );
}

function EditMemberDialog({
  member,
  isSelf,
  onClose,
  onSubmit,
}: {
  member: MemberDto | null;
  isSelf: boolean;
  onClose: () => void;
  onSubmit: (userId: string, name: string) => Promise<void>;
}) {
  const t = useTranslations('dashboard.team');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (member) {
      setName(member.name ?? '');
      setError(null);
      setSubmitting(false);
    }
  }, [member]);

  if (!member) {
    return (
      <Dialog open={false} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent />
      </Dialog>
    );
  }

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== (member.name ?? '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!member || !dirty) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(member.userId, trimmed);
      if (isSelf) {
        try {
          await authClient.updateUser({ name: trimmed });
        } catch {
          /* Better Auth session refresh is best-effort */
        }
      }
      onClose();
    } catch (err) {
      setError(translate(err) || t('errors.rename'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editNameTitle')}</DialogTitle>
          <DialogDescription>{t('editNameSubtitle')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="space-y-2">
            <Label htmlFor="edit-member-name" className={dialogLabelClass}>
              {t('editNameLabel')}
            </Label>
            <Input
              id="edit-member-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              required
              autoFocus
            />
            {!isSelf && (
              <p className={dialogHintClass}>{member.email}</p>
            )}
          </div>

          {error && (
            <p className={cn(dialogHintClass, 'text-destructive')} role="alert">
              {error}
            </p>
          )}

          <DialogFooter className={dialogFooterClass}>
            <Button
              type="button"
              variant="outline"
              className={dialogButtonClass}
              onClick={onClose}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              variant="accent"
              className={dialogButtonClass}
              disabled={submitting || !dirty}
            >
              {submitting ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteTeammateDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (email: string, role: MemberRole) => Promise<void>;
}) {
  const t = useTranslations('dashboard.team');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('member');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(email.trim(), role);
      onOpenChange(false);
    } catch (err) {
      setError(translate(err) || t('errors.invite'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('inviteModalTitle')}</DialogTitle>
          <DialogDescription>{t('inviteModalSub')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="space-y-2">
            <Label htmlFor="invite-email" className={dialogLabelClass}>
              {t('emailLabel')}
            </Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role" className={dialogLabelClass}>
              {t('roleLabel')}
            </Label>
            <NativeSelect
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
            >
              <option value="member">{t('roleMember')}</option>
              <option value="admin">{t('roleAdmin')}</option>
              <option value="owner">{t('roleOwner')}</option>
            </NativeSelect>
            <p className={dialogHintClass}>{t('inviteModalRoleHint')}</p>
          </div>

          {error && (
            <p className={cn(dialogHintClass, 'text-destructive')} role="alert">
              {error}
            </p>
          )}

          <DialogFooter className={dialogFooterClass}>
            <Button
              type="button"
              variant="outline"
              className={dialogButtonClass}
              onClick={() => onOpenChange(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              variant="accent"
              className={dialogButtonClass}
              disabled={submitting}
            >
              {submitting ? t('sending') : t('inviteModalSubmit')}
              <span aria-hidden className="ml-1 font-mono">↵</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

