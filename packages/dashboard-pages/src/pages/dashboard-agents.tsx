'use client';

import { useEffect, useState } from 'react';
import { Bot, Trash2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
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
  const t = useTranslations('dashboard.agents');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const [tokens, setTokens] = useState<TokenDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const list = await api<TokenDto[]>('/api/tokens');
      setTokens(list);
    } catch (err) {
      setError(translate(err) || t('errors.load'));
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
      setError(translate(err) || t('errors.revoke'));
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {tokens === null ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : tokens.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-muted-foreground" />
              <CardTitle>{t('emptyTitle')}</CardTitle>
            </div>
            <CardDescription>{t('emptyBody')}</CardDescription>
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
  const t = useTranslations('dashboard.agents');
  const format = useFormatter();
  const locale = useLocale();
  const isRevoked = token.revokedAt !== null;
  const isExpired = token.expiresAt !== null && new Date(token.expiresAt) < new Date();
  const status: 'active' | 'revoked' | 'expired' = isRevoked
    ? 'revoked'
    : isExpired
      ? 'expired'
      : 'active';
  const fmt = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const typeLabel = labelForType(token.type, t);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{typeLabel}</CardTitle>
            <CardDescription>
              {token.audiences.join(', ') || '—'} · {token.scopes.join(' ') || t('noScopes')}
            </CardDescription>
          </div>
          <span
            className={
              status === 'active'
                ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700'
                : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
            }
          >
            {t(`status.${status}` as 'status.active' | 'status.revoked' | 'status.expired')}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <div className="space-y-0.5" lang={locale}>
          <div>{t('issued', { when: fmt(token.createdAt) })}</div>
          {token.lastUsedAt && <div>{t('lastUsed', { when: fmt(token.lastUsedAt) })}</div>}
          {token.expiresAt && <div>{t('expires', { when: fmt(token.expiresAt) })}</div>}
        </div>
        {!isRevoked && (
          <Button variant="outline" size="sm" onClick={() => onRevoke()}>
            <Trash2 className="size-4" />
            {t('revoke')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function labelForType(type: string, t: ReturnType<typeof useTranslations<'dashboard.agents'>>): string {
  if (type === 'oauth_access') return t('types.oauth_access');
  if (type === 'oauth_refresh') return t('types.oauth_refresh');
  if (type === 'delegated_end_user') return t('types.delegated_end_user');
  if (type === 'guest') return t('types.guest');
  return type;
}
