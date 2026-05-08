'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Copy, Mail, MailX, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Hero,
  Input,
  Label,
  SectionHead,
} from '@getmunin/ui';
import { nativeFieldClass } from '../components/page-shell';

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
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [invites, setInvites] = useState<InvitationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('member');
  const [submitting, setSubmitting] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [m, i] = await Promise.all([
        api<MemberDto[]>('/api/v1/orgs/me/members'),
        api<InvitationDto[]>('/api/v1/orgs/me/invitations'),
      ]);
      setMembers(m);
      setInvites(i);
    } catch (err) {
      setError(translate(err) || t('errors.load'));
    }
  }, [t, translate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    setLinkCopied(false);
    try {
      const created = await api<CreatedInvitationDto>('/api/v1/orgs/me/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteEmail('');
      if (!created.mailerConfigured) {
        setPendingShare({ email: created.email, acceptUrl: created.acceptUrl });
      } else {
        setPendingShare(null);
      }
      await load();
    } catch (err) {
      setError(translate(err) || t('errors.invite'));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyAcceptUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
    }
  }

  async function revokeInvite(id: string) {
    try {
      await api(`/api/v1/orgs/me/invitations/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(translate(err) || t('errors.revokeInvite'));
    }
  }

  async function removeMember(userId: string) {
    if (!confirm(t('removeConfirm'))) return;
    try {
      await api(`/api/v1/orgs/me/members/${userId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(translate(err) || t('errors.remove'));
    }
  }

  async function changeRole(userId: string, role: MemberRole) {
    try {
      await api(`/api/v1/orgs/me/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await load();
    } catch (err) {
      setError(translate(err) || t('errors.changeRole'));
    }
  }

  return (
    <>
      <Hero title={t('title')} lede={t('subtitle')} />

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserPlus className="size-5 text-muted-foreground" />
            <CardTitle className="text-base">{t('inviteTitle')}</CardTitle>
          </div>
          <CardDescription>{t('inviteDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              void invite(e);
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              <Input
                id="email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="role">{t('roleLabel')}</Label>
              <select
                id="role"
                className={nativeFieldClass}
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as MemberRole)}
              >
                <option value="member">{t('roleMember')}</option>
                <option value="admin">{t('roleAdmin')}</option>
                <option value="owner">{t('roleOwner')}</option>
              </select>
            </div>
            <Button type="submit" disabled={submitting}>
              <Mail className="size-4" />
              {submitting ? t('sending') : t('sendInvite')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ManualShareDialog
        open={pendingShare !== null}
        closeLabel={t('close')}
        onClose={() => {
          setPendingShare(null);
          setLinkCopied(false);
        }}
      >
        {pendingShare && (
          <>
            <div className="flex items-center gap-2">
              <MailX className="size-5 text-amber-600" />
              <h2 className="text-base font-semibold">{t('manualShareTitle')}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {t.rich('manualShareBody', {
                email: pendingShare.email,
                recipient: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                code: (chunks) => (
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{chunks}</code>
                ),
              })}
            </p>
            <code className="block break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
              {pendingShare.acceptUrl}
            </code>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t('manualShareValid')}</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void copyAcceptUrl(pendingShare.acceptUrl);
                  }}
                >
                  <Copy className="size-4" />
                  {linkCopied ? t('copied') : t('copyLink')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setPendingShare(null);
                    setLinkCopied(false);
                  }}
                >
                  {t('done')}
                </Button>
              </div>
            </div>
          </>
        )}
      </ManualShareDialog>

      <section className="space-y-4">
        <SectionHead title={members ? t('membersTitleCount', { count: members.length }) : t('membersTitle')} />
        {members === null ? (
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                  <th className="px-3 py-2">{t('membersTableName')}</th>
                  <th className="px-3 py-2">{t('membersTableEmail')}</th>
                  <th className="px-3 py-2">{t('membersTableRole')}</th>
                  <th className="px-3 py-2">{t('membersTableJoined')}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} className="border-t">
                    <td className="px-3 py-2">{m.name ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{m.email}</td>
                    <td className="px-3 py-2">
                      <select
                        className={nativeFieldClass + ' h-8 text-xs'}
                        value={m.role}
                        onChange={(e) => {
                          void changeRole(m.userId, e.target.value as MemberRole);
                        }}
                      >
                        <option value="member">{t('roleMemberLower')}</option>
                        <option value="admin">{t('roleAdminLower')}</option>
                        <option value="owner">{t('roleOwnerLower')}</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {format.dateTime(new Date(m.joinedAt), { dateStyle: 'medium' })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void removeMember(m.userId);
                        }}
                      >
                        <Trash2 className="size-4" />
                        {t('remove')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHead title={invites ? t('invitesTitleCount', { count: invites.length }) : t('invitesTitle')} />
        {invites === null ? (
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        ) : invites.length === 0 ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="size-5 text-muted-foreground" />
                <CardTitle>{t('invitesEmptyTitle')}</CardTitle>
              </div>
              <CardDescription>{t('invitesEmptyBody')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-4 rounded-lg border bg-background px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('inviteRow', {
                      role: inv.role,
                      created: format.dateTime(new Date(inv.createdAt), { dateStyle: 'medium' }),
                      expires: format.dateTime(new Date(inv.expiresAt), { dateStyle: 'medium' }),
                    })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void revokeInvite(inv.id);
                  }}
                >
                  <Trash2 className="size-4" />
                  {t('revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ManualShareDialog({
  open,
  closeLabel,
  onClose,
  children,
}: {
  open: boolean;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg space-y-4 rounded-lg border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
