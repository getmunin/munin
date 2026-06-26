'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { TableSkeleton } from '../components/skeleton';
import { EmptyCallout } from '../components/empty-callout';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import { notify } from '../lib/notify';
import { Button, Hero, SectionHead, cn } from '@getmunin/ui';

interface TokenDto {
  id: string;
  type: string;
  scopes: string[];
  audiences: string[];
  origin: string | null;
  iconUrl: string | null;
  user?: { name: string | null; email: string } | null;
  endUserId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  count?: number;
}

type TokenStatus = 'active' | 'revoked' | 'expired';

export function AgentsPage() {
  const t = useTranslations('dashboard.agents');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const format = useFormatter();
  const [tokens, setTokens] = useState<TokenDto[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await api<TokenDto[]>('/v1/tokens');
    setTokens(list);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await api(`/v1/tokens/${id}`, { method: 'DELETE' });
      await tryLoad();
      notify.success(t('revoked'));
    } catch (err) {
      notify.error(translate(err) || t('errors.revoke'));
    } finally {
      setRevokingId(null);
    }
  }

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('agents', loadError, () => void retry(), retrying)}
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
          title={tokens ? t('agentsTitleCount', { count: tokens.length }) : t('agentsTitle')}
          divider={false}
        />

        {tokens === null ? (
          <TableSkeleton
            columns={[
              { grow: 3, bar: 'w-3/4' },
              { grow: 2, bar: 'w-1/2' },
              { grow: 1.5, bar: 'w-12' },
              { grow: 2, bar: 'w-3/4' },
              { grow: 2, bar: 'w-3/4' },
              { grow: 2, bar: 'w-3/4' },
              { grow: 1, bar: 'w-10', right: true },
            ]}
          />
        ) : tokens.length === 0 ? (
          <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <div className="-mx-6 overflow-x-auto px-6 md:mx-0 md:px-0">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b-[0.5px] border-rule-soft dark:border-rule-on-dark text-left">
                <Th className="w-[40%]">{t('tableToken')}</Th>
                <Th className="w-[10%]">{t('tableStatus')}</Th>
                <Th className="hidden md:table-cell w-[14%]">{t('tableIssued')}</Th>
                <Th className="hidden md:table-cell w-[14%]">{t('tableLastUsed')}</Th>
                <Th className="hidden md:table-cell w-[14%]">{t('tableExpires')}</Th>
                <Th className="text-right w-[8%]" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const status: TokenStatus =
                  token.revokedAt !== null
                    ? 'revoked'
                    : token.expiresAt !== null && new Date(token.expiresAt) < new Date()
                      ? 'expired'
                      : 'active';
                const primaryName = token.origin ?? '—';
                const issued = format.dateTime(new Date(token.createdAt), {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const lastUsed = token.lastUsedAt
                  ? format.dateTime(new Date(token.lastUsedAt), {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : '—';
                const expires = token.expiresAt
                  ? format.dateTime(new Date(token.expiresAt), {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : '—';
                return (
                  <tr
                    key={token.id}
                    className="border-b-[0.5px] border-rule-soft dark:border-rule-on-dark align-middle"
                  >
                    <td className="py-4 pr-4 align-top">
                      <div className="flex items-center gap-2 text-sm font-medium text-ink dark:text-foreground">
                        <ClientGlyph iconUrl={token.iconUrl} name={primaryName} />
                        <span>
                          {primaryName}
                          {token.user && (
                            <span
                              className="ml-1.5 font-normal text-ink-mute"
                              title={token.user.email}
                            >
                              · {token.user.name ?? token.user.email}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[11px] leading-relaxed text-ink-mute break-words">
                        {token.scopes.length > 0 ? token.scopes.join(' ') : t('noScopes')}
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <StatusChip status={status} t={t} />
                    </td>
                    <td className="hidden md:table-cell py-4 pr-4 font-mono text-xs text-ink-mute">{issued}</td>
                    <td className="hidden md:table-cell py-4 pr-4 font-mono text-xs text-ink-mute">{lastUsed}</td>
                    <td className="hidden md:table-cell py-4 pr-4 font-mono text-xs text-ink-mute">{expires}</td>
                    <td className="py-4 text-right">
                      {status === 'active' && (
                        <Button
                          variant="outline"
                          size="sm"
                          pending={revokingId === token.id}
                          onClick={() => void revoke(token.id)}
                        >
                          {tCommon('revoke')}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </>
  );
}

function ClientGlyph({ iconUrl, name }: { iconUrl: string | null; name: string }) {
  const glyph = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] border-[0.5px] border-rule-soft bg-white font-serif text-[10px] leading-none text-ink dark:border-rule-on-dark">
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          className="size-3 object-contain"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        glyph
      )}
    </span>
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

function StatusChip({
  status,
  t,
}: {
  status: TokenStatus;
  t: ReturnType<typeof useTranslations<'dashboard.agents'>>;
}) {
  const label = t(`status.${status}`);
  return (
    <span
      className={cn(
        'inline-block px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow',
        status === 'active'
          ? 'bg-cobalt/15 text-cobalt-deep dark:bg-cobalt-soft/20 dark:text-cobalt-soft'
          : 'border-[0.5px] border-rule-soft dark:border-rule-on-dark text-ink-mute',
      )}
    >
      {label}
    </span>
  );
}
