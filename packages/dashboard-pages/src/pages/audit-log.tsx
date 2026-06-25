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
import { NativeSelect } from '../components/native-select';
import { Button, Hero, Input, SectionHead, cn } from '@getmunin/ui';

type ClientKind = 'sdk' | 'cli' | 'mcp' | 'unknown';

interface AuditDto {
  id: string;
  actorType: string;
  actorId: string | null;
  tool: string | null;
  method: string | null;
  result: string | null;
  error: string | null;
  correlationId: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  userAgent: string | null;
  client: ClientKind;
  createdAt: string;
}

interface AuditPage {
  items: AuditDto[];
  nextCursor: string | null;
}

export function AuditLogPage() {
  const t = useTranslations('dashboard.auditLog');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const format = useFormatter();
  const [items, setItems] = useState<AuditDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [filters, setFilters] = useState({ tool: '', actorType: '', correlationId: '', client: '' });

  const fetchPage = useCallback(
    async (
      reset: boolean,
      filterValues: { tool: string; actorType: string; correlationId: string; client: string },
      beforeCursor: string | null,
    ) => {
      const params = new URLSearchParams();
      if (filterValues.tool) params.set('tool', filterValues.tool);
      if (filterValues.actorType) params.set('actorType', filterValues.actorType);
      if (filterValues.correlationId) params.set('correlationId', filterValues.correlationId);
      if (filterValues.client) params.set('client', filterValues.client);
      if (!reset && beforeCursor) params.set('before', beforeCursor);
      const page = await api<AuditPage>(`/v1/audit-logs?${params.toString()}`);
      if (reset) {
        setItems(page.items);
      } else {
        setItems((prev) => [...prev, ...page.items]);
      }
      setCursor(page.nextCursor);
      setExhausted(page.nextCursor === null);
    },
    [],
  );

  const load = useCallback(
    async (
      reset: boolean,
      filterValues: { tool: string; actorType: string; correlationId: string; client: string },
      beforeCursor: string | null,
    ) => {
      try {
        await fetchPage(reset, filterValues, beforeCursor);
      } catch (err) {
        notify.error(translate(err) || t('errors.load'));
      }
    },
    [fetchPage, t, translate],
  );

  const initialLoad = useCallback(async () => {
    await fetchPage(true, { tool: '', actorType: '', correlationId: '', client: '' }, null);
  }, [fetchPage]);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(initialLoad);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('audit-log', loadError, () => void retry(), retrying)}
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

      <form
        className="grid gap-3 md:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          setCursor(null);
          setExhausted(false);
          void load(true, filters, null);
        }}
      >
        <Input
          value={filters.tool}
          onChange={(e) => setFilters((f) => ({ ...f, tool: e.target.value }))}
          placeholder={t('filterTool')}
          className="font-mono text-xs"
        />
        <Input
          value={filters.actorType}
          onChange={(e) => setFilters((f) => ({ ...f, actorType: e.target.value }))}
          placeholder={t('filterActorType')}
          className="font-mono text-xs"
        />
        <Input
          value={filters.correlationId}
          onChange={(e) => setFilters((f) => ({ ...f, correlationId: e.target.value }))}
          placeholder={t('filterCorrelationId')}
          className="font-mono text-xs"
        />
        <NativeSelect
          wrapperClassName="w-auto"
          className="font-mono text-xs"
          value={filters.client}
          onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))}
        >
          <option value="">{t('clientAny')}</option>
          <option value="sdk">sdk</option>
          <option value="cli">cli</option>
          <option value="mcp">mcp</option>
          <option value="unknown">unknown</option>
        </NativeSelect>
        <Button type="submit" variant="outline">
          {tCommon('apply')}
        </Button>
      </form>

      <section className="space-y-4">
        <SectionHead
          title={t('trailTitleCount', { count: items.length })}
          meta={t('appendOnly')}
          divider={false}
        />

        {!hasLoadedOnce ? (
          <TableSkeleton
            columns={[
              { grow: 2, bar: 'w-3/4' },
              { grow: 1.5, bar: 'w-1/2' },
              { grow: 1.5, bar: 'w-12' },
              { grow: 2.5, bar: 'w-2/3' },
              { grow: 1.5, bar: 'w-12' },
              { grow: 1, bar: 'w-10', right: true },
              { grow: 1.5, bar: 'w-16', right: true },
            ]}
          />
        ) : items.length === 0 ? (
          <EmptyCallout title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <div className="-mx-6 overflow-x-auto px-6 md:mx-0 md:px-0">
          <table className="w-full">
            <thead>
              <tr className="border-b-[0.5px] border-rule-soft dark:border-rule-on-dark text-left">
                <Th>{t('tableTime')}</Th>
                <Th className="hidden md:table-cell">{t('tableActor')}</Th>
                <Th className="hidden md:table-cell">{t('tableClient')}</Th>
                <Th>{t('tableToolMethod')}</Th>
                <Th>{t('tableResult')}</Th>
                <Th className="text-right">{t('tableTokens')}</Th>
                <Th className="hidden md:table-cell text-right">{t('tableCorrelation')}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  className="border-b-[0.5px] border-rule-soft dark:border-rule-on-dark align-top"
                >
                  <td className="py-3 pr-4 font-mono text-[11px] text-ink-mute whitespace-nowrap">
                    {format.dateTime(new Date(row.createdAt), {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="hidden md:table-cell py-3 pr-4 font-mono text-[11px] text-ink dark:text-foreground">
                    {row.actorType}
                  </td>
                  <td
                    className="hidden md:table-cell py-3 pr-4 font-mono text-[11px] text-ink-mute"
                    title={row.userAgent ?? undefined}
                  >
                    {row.client}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[11px] text-ink dark:text-foreground">
                    {row.tool ?? row.method ?? '—'}
                  </td>
                  <td className="py-3 pr-4">
                    <ResultChip result={row.result} />
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-[11px] tabular-nums text-ink dark:text-foreground">
                    {row.totalTokens != null ? format.number(row.totalTokens) : '—'}
                  </td>
                  <td className="hidden md:table-cell py-3 pr-4 text-right font-mono text-[11px] text-ink-mute">
                    {row.correlationId?.slice(0, 8) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {!exhausted && items.length > 0 && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={() => void load(false, filters, cursor)}>
              {tCommon('loadMore')}
            </Button>
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

function ResultChip({ result }: { result: string | null }) {
  if (!result) return <span className="font-mono text-[11px] text-ink-mute">—</span>;
  return (
    <span
      className={cn(
        'inline-block px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow',
        result === 'ok'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
          : result === 'denied'
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
            : 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
      )}
    >
      {result}
    </span>
  );
}
