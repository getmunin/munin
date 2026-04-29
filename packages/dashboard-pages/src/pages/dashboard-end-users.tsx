'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { api, ApiError } from '../api';
import { Button } from '@getmunin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';

interface EndUserDto {
  id: string;
  externalId: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function EndUsersPage() {
  const [items, setItems] = useState<EndUserDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const list = await api<EndUserDto[]>('/api/end-users');
      setItems(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load end-users.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revokeTokens(id: string) {
    setRevokingId(id);
    try {
      const result = await api<{ revoked: number }>(`/api/end-users/${id}/revoke-tokens`, {
        method: 'POST',
      });
      setError(
        result.revoked > 0
          ? null
          : 'No active tokens to revoke for this end-user.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke tokens.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">End-users</h1>
        <p className="text-sm text-muted-foreground">
          People your customer-facing agents act on behalf of. Created server-side via the SDK or
          <code className="mx-1">/api/end-users/lookup</code>; never trusted from agent input.
        </p>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {items === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="size-5 text-muted-foreground" />
              <CardTitle>No end-users yet</CardTitle>
            </div>
            <CardDescription>
              Mint your first delegated end-user token via{' '}
              <code>POST /api/delegated-token</code> with an admin key from your backend, and the
              corresponding EndUser will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">External id</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((eu) => (
                <tr key={eu.id} className="border-t">
                  <td className="px-3 py-2">{eu.name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {eu.externalId ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {eu.email ?? eu.phone ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(eu.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revokingId === eu.id}
                      onClick={() => {
                        void revokeTokens(eu.id);
                      }}
                    >
                      {revokingId === eu.id ? 'Revoking…' : 'Revoke active tokens'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
