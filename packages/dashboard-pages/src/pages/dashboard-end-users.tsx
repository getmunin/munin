'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
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
  const t = useTranslations('dashboard.endUsers');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const format = useFormatter();
  const [items, setItems] = useState<EndUserDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const list = await api<EndUserDto[]>('/api/end-users');
      setItems(list);
    } catch (err) {
      setError(translate(err) || t('errors.load'));
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
      setError(result.revoked > 0 ? null : t('noTokensRevoked'));
    } catch (err) {
      setError(translate(err) || t('errors.revoke'));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t.rich('subtitle', {
            code: (chunks) => <code className="mx-1">{chunks}</code>,
          })}
        </p>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {items === null ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="size-5 text-muted-foreground" />
              <CardTitle>{t('emptyTitle')}</CardTitle>
            </div>
            <CardDescription>
              {t.rich('emptyBody', {
                code: (chunks) => <code>{chunks}</code>,
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                <th className="px-3 py-2">{t('tableName')}</th>
                <th className="px-3 py-2">{t('tableExternalId')}</th>
                <th className="px-3 py-2">{t('tableContact')}</th>
                <th className="px-3 py-2">{t('tableCreated')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((eu) => (
                <tr key={eu.id} className="border-t">
                  <td className="px-3 py-2">
                    {eu.name ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {eu.externalId ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {eu.email ?? eu.phone ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {format.dateTime(new Date(eu.createdAt), { dateStyle: 'medium' })}
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
                      {revokingId === eu.id ? t('revoking') : t('revokeActive')}
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
