'use client';

import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
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

export function ApiKeysPage() {
  const t = useTranslations('dashboard.apiKeys');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const format = useFormatter();
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
      setError(translate(err) || t('errors.load'));
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
      setError(translate(err) || t('errors.create'));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/api-keys/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(translate(err) || t('errors.revoke'));
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('createTitle')}</CardTitle>
          <CardDescription>{t('createDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              void create(e);
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="name">{t('nameLabel')}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                required
              />
            </div>
            <Button type="submit" disabled={creating}>
              <Plus className="size-4" />
              {creating ? t('creating') : t('create')}
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
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : keys.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="size-5 text-muted-foreground" />
              <CardTitle>{t('emptyTitle')}</CardTitle>
            </div>
            <CardDescription>{t('emptyBody')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => {
            const createdLabel = format.dateTime(new Date(k.createdAt), { dateStyle: 'medium' });
            const lastUsedLabel = k.lastUsedAt
              ? format.dateTime(new Date(k.lastUsedAt), { dateStyle: 'medium', timeStyle: 'short' })
              : null;
            return (
              <li
                key={k.id}
                className="flex items-center justify-between gap-4 rounded-lg border bg-background px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{k.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {lastUsedLabel
                      ? t.rich('rowMetaWithLast', {
                          prefix: k.prefix,
                          created: createdLabel,
                          lastUsed: lastUsedLabel,
                          code: (chunks) => <span className="font-mono">{chunks}</span>,
                        })
                      : t.rich('rowMeta', {
                          prefix: k.prefix,
                          created: createdLabel,
                          code: (chunks) => <span className="font-mono">{chunks}</span>,
                        })}
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
                  {t('revoke')}
                </Button>
              </li>
            );
          })}
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
  const t = useTranslations('dashboard.apiKeys');
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
        <CardTitle className="text-base">{t('createdTitle')}</CardTitle>
        <CardDescription>{t('createdDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border bg-background px-3 py-2 font-mono text-sm">
            {created.key}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy className="size-4" />
            {copied ? t('copied') : t('copy')}
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t('savedIt')}
        </Button>
      </CardContent>
    </Card>
  );
}
