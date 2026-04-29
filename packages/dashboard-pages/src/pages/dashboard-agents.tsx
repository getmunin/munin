'use client';

import { useEffect, useState } from 'react';
import { Bot, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api';
import { Button } from '@getmunin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';

interface TokenDto {
  id: string;
  type: string;
  scopes: string[];
  audiences: string[];
  endUserId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function AgentsPage() {
  const [tokens, setTokens] = useState<TokenDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const list = await api<TokenDto[]>('/api/tokens');
      setTokens(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load connected agents.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(id: string) {
    try {
      await api(`/api/tokens/${id}/revoke`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke token.');
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connected agents</h1>
        <p className="text-sm text-muted-foreground">
          Every OAuth-authorized agent and end-user token issued for this org. Revoke any active
          token to immediately invalidate further MCP calls.
        </p>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {tokens === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tokens.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-muted-foreground" />
              <CardTitle>No connected agents yet</CardTitle>
            </div>
            <CardDescription>
              Add the MCP URL to Claude Desktop, Cursor, or your runtime, then complete consent —
              issued tokens will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {tokens.map((token) => (
            <TokenCard
              key={token.id}
              token={token}
              onRevoke={() => {
                void revoke(token.id);
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function TokenCard({ token, onRevoke }: { token: TokenDto; onRevoke: () => void }) {
  const isRevoked = token.revokedAt !== null;
  const isExpired = token.expiresAt !== null && new Date(token.expiresAt) < new Date();
  const status = isRevoked ? 'revoked' : isExpired ? 'expired' : 'active';
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{labelForType(token.type)}</CardTitle>
            <CardDescription>
              {token.audiences.join(', ') || '—'} · {token.scopes.join(' ') || 'no scopes'}
            </CardDescription>
          </div>
          <span
            className={
              status === 'active'
                ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700'
                : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
            }
          >
            {status}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <div className="space-y-0.5">
          <div>Issued {fmt(token.createdAt)}</div>
          {token.lastUsedAt && <div>Last used {fmt(token.lastUsedAt)}</div>}
          {token.expiresAt && <div>Expires {fmt(token.expiresAt)}</div>}
        </div>
        {!isRevoked && (
          <Button variant="outline" size="sm" onClick={() => onRevoke()}>
            <Trash2 className="size-4" />
            Revoke
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function labelForType(type: string): string {
  if (type === 'oauth_access') return 'OAuth access token';
  if (type === 'oauth_refresh') return 'OAuth refresh token';
  if (type === 'delegated_end_user') return 'Delegated end-user token';
  if (type === 'guest') return 'Guest token';
  return type;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString();
}
