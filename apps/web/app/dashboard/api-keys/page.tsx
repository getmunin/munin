'use client';

import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

interface CreatedApiKey {
  id: string;
  name: string;
  key: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);

  async function load() {
    try {
      setError(null);
      const list = await api<ApiKeySummary[]>('/api/api-keys');
      setKeys(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load API keys.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await api<CreatedApiKey>('/api/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), scopes: ['*'] }),
      });
      setJustCreated(created);
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create API key.');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/api-keys/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke API key.');
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Long-lived admin keys for server-to-server integrations and programmatic admin agents.
          Self-hosters and CI use these too. Treat them like passwords.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a new key</CardTitle>
          <CardDescription>
            The plaintext value is shown ONCE, immediately after creation. Copy it now and store it
            in your secret manager.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              void create(e);
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. production-backend"
                required
              />
            </div>
            <Button type="submit" disabled={creating}>
              <Plus className="size-4" />
              {creating ? 'Creating…' : 'Create key'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {justCreated && <NewKeyCallout created={justCreated} onDismiss={() => setJustCreated(null)} />}

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {keys === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : keys.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="size-5 text-muted-foreground" />
              <CardTitle>No API keys yet</CardTitle>
            </div>
            <CardDescription>Create your first key above to get started.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-4 rounded-lg border bg-background px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{k.name}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{k.prefix}…</span> · created{' '}
                  {new Date(k.createdAt).toLocaleDateString()}
                  {k.lastUsedAt && (
                    <>
                      {' · last used '}
                      {new Date(k.lastUsedAt).toLocaleString()}
                    </>
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void revoke(k.id);
                }}
              >
                <Trash2 className="size-4" />
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NewKeyCallout({
  created,
  onDismiss,
}: {
  created: CreatedApiKey;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(created.key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <Card className="border-emerald-200 bg-emerald-50">
      <CardHeader>
        <CardTitle className="text-base">Key created — copy it now</CardTitle>
        <CardDescription>
          Munin only stores the hash. We can&apos;t show you this key again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border bg-background px-3 py-2 font-mono text-sm">
            {created.key}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy className="size-4" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          I&apos;ve saved it
        </Button>
      </CardContent>
    </Card>
  );
}
