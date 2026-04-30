'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Mail, MailX, Trash2, UserPlus, Users, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { Button } from '@getmunin/ui';
import { Input } from '@getmunin/ui';
import { Label } from '@getmunin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';

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
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [invites, setInvites] = useState<InvitationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner' | 'member'>('member');
  const [submitting, setSubmitting] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  async function load() {
    try {
      setError(null);
      const [m, i] = await Promise.all([
        api<MemberDto[]>('/api/orgs/me/members'),
        api<InvitationDto[]>('/api/orgs/me/invitations'),
      ]);
      setMembers(m);
      setInvites(i);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load team.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    setLinkCopied(false);
    try {
      const created = await api<CreatedInvitationDto>('/api/orgs/me/invitations', {
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
      setError(err instanceof ApiError ? err.message : 'Could not send invite.');
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
      await api(`/api/orgs/me/invitations/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke invite.');
    }
  }

  async function removeMember(userId: string) {
    if (!confirm('Remove this member? They lose access to the org immediately.')) return;
    try {
      await api(`/api/orgs/me/members/${userId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove member.');
    }
  }

  async function changeRole(userId: string, role: 'owner' | 'member') {
    try {
      await api(`/api/orgs/me/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change role.');
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          Members and pending invitations for this org. Owners can invite others, change roles,
          and remove members; members can use the apps but can&apos;t manage access.
        </p>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserPlus className="size-5 text-muted-foreground" />
            <CardTitle className="text-base">Invite a teammate</CardTitle>
          </div>
          <CardDescription>
            They&apos;ll get an email with a link to accept. The link expires in 7 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              void invite(e);
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'owner' | 'member')}
              >
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <Button type="submit" disabled={submitting}>
              <Mail className="size-4" />
              {submitting ? 'Sending…' : 'Send invite'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ManualShareDialog
        open={pendingShare !== null}
        onClose={() => {
          setPendingShare(null);
          setLinkCopied(false);
        }}
      >
        {pendingShare && (
          <>
            <div className="flex items-center gap-2">
              <MailX className="size-5 text-amber-600" />
              <h2 className="text-base font-semibold">
                Email isn&apos;t configured — share this link manually
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">
              No email provider is set up on this Munin instance, so we didn&apos;t send an
              email. Send the link below to{' '}
              <span className="font-medium text-foreground">{pendingShare.email}</span>{' '}
              yourself, or set{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">MUNIN_MAIL_PROVIDER</code>{' '}
              (e.g.{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">resend</code>)
              and restart so future invites mail automatically.
            </p>
            <code className="block break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
              {pendingShare.acceptUrl}
            </code>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Valid for 7 days.</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void copyAcceptUrl(pendingShare.acceptUrl);
                  }}
                >
                  <Copy className="size-4" />
                  {linkCopied ? 'Copied' : 'Copy link'}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setPendingShare(null);
                    setLinkCopied(false);
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          </>
        )}
      </ManualShareDialog>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Members {members && `(${members.length})`}
        </h2>
        {members === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Joined</th>
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
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        value={m.role}
                        onChange={(e) => {
                          void changeRole(m.userId, e.target.value as 'owner' | 'member');
                        }}
                      >
                        <option value="member">member</option>
                        <option value="owner">owner</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(m.joinedAt).toLocaleDateString()}
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
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Pending invitations {invites && `(${invites.length})`}
        </h2>
        {invites === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : invites.length === 0 ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="size-5 text-muted-foreground" />
                <CardTitle>No pending invitations</CardTitle>
              </div>
              <CardDescription>
                Use the form above to invite someone — they&apos;ll appear here until accepted.
              </CardDescription>
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
                    {inv.role} · invited {new Date(inv.createdAt).toLocaleDateString()} · expires{' '}
                    {new Date(inv.expiresAt).toLocaleDateString()}
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
                  Revoke
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
  onClose,
  children,
}: {
  open: boolean;
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
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
