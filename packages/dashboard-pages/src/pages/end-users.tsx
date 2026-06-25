'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { TableSkeleton } from '../components/skeleton';
import { EmptyCallout } from '../components/empty-callout';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import { notify } from '../lib/notify';
import { Button, Hero, Input, SectionHead, cn } from '@getmunin/ui';

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
  const translate = useTranslateError();
  const format = useFormatter();
  const now = useNow();
  const [items, setItems] = useState<EndUserDto[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const list = await api<EndUserDto[]>('/v1/end-users');
    setItems(list);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  const filtered = useMemo(() => {
    if (items === null) return null;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((u) =>
      [u.name, u.email, u.phone, u.externalId]
        .filter((v): v is string => typeof v === 'string')
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [items, query]);

  async function revokeTokens(id: string) {
    setRevokingId(id);
    try {
      const result = await api<{ revoked: number }>(`/v1/end-users/${id}/revoke-tokens`, {
        method: 'POST',
      });
      if (result.revoked > 0) {
        notify.success(t('revokedCount', { count: result.revoked }));
      } else {
        notify.info(t('noTokensRevoked'));
      }
    } catch (err) {
      notify.error(translate(err) || t('errors.revoke'));
    } finally {
      setRevokingId(null);
    }
  }

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('end-users', loadError, () => void retry(), retrying)}
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
          title={items ? t('endUsersTitleCount', { count: items.length }) : t('endUsersTitle')}
          actions={
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-60 font-mono text-xs"
            />
          }
          divider={false}
        />

        {filtered === null ? (
          <TableSkeleton
            columns={[
              { grow: 4, bar: 'w-2/3' },
              { grow: 3, bar: 'w-1/2' },
              { grow: 2, bar: 'w-3/4' },
              { grow: 1, bar: 'w-10', right: true },
            ]}
          />
        ) : filtered.length === 0 ? (
          <EmptyCallout
            title={items && items.length === 0 ? t('emptyTitle') : t('emptyTitle')}
            body={
              items && items.length === 0
                ? t.rich('emptyBody', { code: (chunks) => <code>{chunks}</code> })
                : '—'
            }
          />
        ) : (
          <div className="-mx-6 overflow-x-auto px-6 md:mx-0 md:px-0">
          <table className="w-full">
            <thead>
              <tr className="border-b-[0.5px] border-rule-soft dark:border-rule-on-dark text-left">
                <Th>{t('tablePerson')}</Th>
                <Th className="hidden md:table-cell">{t('tableExternalId')}</Th>
                <Th>{t('tableLastContact')}</Th>
                <Th className="text-right" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((eu) => (
                <tr key={eu.id} className="border-b-[0.5px] border-rule-soft dark:border-rule-on-dark">
                  <td className="py-4 pr-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={eu.name} />
                      <div>
                        <div className="text-sm font-medium text-ink dark:text-foreground">
                          {eu.name ?? '—'}
                        </div>
                        <div className="font-mono text-[11px] text-ink-mute">
                          {eu.email ?? eu.phone ?? '—'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden md:table-cell py-4 pr-4 font-mono text-xs text-ink-mute">
                    {eu.externalId ?? '—'}
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs text-ink-mute">
                    {format.relativeTime(new Date(eu.updatedAt), now)}
                  </td>
                  <td className="py-4 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      pending={revokingId === eu.id}
                      onClick={() => void revokeTokens(eu.id)}
                    >
                      {t('revokeActive')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
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

function Avatar({ name }: { name: string | null }) {
  const initials =
    name && name !== '—'
      ? name
          .split(/\s+/)
          .map((s) => s[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
      : '?';
  return (
    <span className="inline-flex size-9 items-center justify-center rounded-full bg-paper-deep dark:bg-secondary font-mono text-[11px] uppercase text-ink dark:text-foreground">
      {initials}
    </span>
  );
}
