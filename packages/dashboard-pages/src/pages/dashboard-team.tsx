'use client';

import { useEffect, useState } from 'react';
import { Mail, Trash2, UserPlus, Users } from 'lucide-react';
import { api, ApiError } from '../api';
import { Button } from '@munin/ui';
import { Input } from '@munin/ui';
import { Label } from '@munin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@munin/ui';

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

export function TeamPage() {
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [invites, setInvites] = useState<InvitationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner' | 'member'>('member');
  const [submitting, setSubmitting] = useState(false);

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
    try {
      await api('/api/orgs/me/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteEmail('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send invite.');
    } finally {
      setSubmitting(false);
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
