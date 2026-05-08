'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Hero,
  Input,
  Label,
} from '@getmunin/ui';

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
  const translate = useTranslateError();
  const format = useFormatter();
  const [items, setItems] = useState<AuditDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ tool: '', actorType: '', correlationId: '', client: '' });

  const load = useCallback(
    async (
      reset: boolean,
      filterValues: { tool: string; actorType: string; correlationId: string; client: string },
      beforeCursor: string | null,
    ) => {
      try {
        const params = new URLSearchParams();
        if (filterValues.tool) params.set('tool', filterValues.tool);
        if (filterValues.actorType) params.set('actorType', filterValues.actorType);
        if (filterValues.correlationId) params.set('correlationId', filterValues.correlationId);
        if (filterValues.client) params.set('client', filterValues.client);
        if (!reset && beforeCursor) params.set('before', beforeCursor);
        const page = await api<AuditPage>(`/api/v1/admin/audit-logs?${params.toString()}`);
        setError(null);
        if (reset) {
          setItems(page.items);
        } else {
          setItems((prev) => [...prev, ...page.items]);
        }
        setCursor(page.nextCursor);
        setExhausted(page.nextCursor === null);
      } catch (err) {
        setError(translate(err) || t('errors.load'));
      }
    },
    [t, translate],
  );

  useEffect(() => {
    void load(true, { tool: '', actorType: '', correlationId: '', client: '' }, null);
  }, [load]);

  return (
    <>
      <Hero title={t('title')} lede={t('subtitle')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('filterTitle')}</CardTitle>
          <CardDescription>{t('filterDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              setCursor(null);
              setExhausted(false);
              void load(true, filters, null);
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="tool">{t('filterTool')}</Label>
              <Input
                id="tool"
                value={filters.tool}
                onChange={(e) => setFilters((f) => ({ ...f, tool: e.target.value }))}
                placeholder="kb_search"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="actorType">{t('filterActorType')}</Label>
              <Input
                id="actorType"
                value={filters.actorType}
                onChange={(e) => setFilters((f) => ({ ...f, actorType: e.target.value }))}
                placeholder="admin_agent"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="correlationId">{t('filterCorrelationId')}</Label>
              <Input
                id="correlationId"
                value={filters.correlationId}
                onChange={(e) => setFilters((f) => ({ ...f, correlationId: e.target.value }))}
                placeholder="uuid"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="client">{t('filterClient')}</Label>
              <select
                id="client"
                value={filters.client}
                onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))}
                className="h-9 w-full rounded-md border border-rule-soft bg-paper px-2 text-sm dark:bg-card dark:border-rule-on-dark"
              >
                <option value="">{t('clientAny')}</option>
                <option value="sdk">sdk</option>
                <option value="cli">cli</option>
                <option value="mcp">mcp</option>
                <option value="unknown">unknown</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                {t('apply')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ScrollText className="size-5 text-muted-foreground" />
              <CardTitle>{t('emptyTitle')}</CardTitle>
            </div>
            <CardDescription>{t('emptyBody')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                <th className="px-3 py-2">{t('tableTime')}</th>
                <th className="px-3 py-2">{t('tableActor')}</th>
                <th className="px-3 py-2">{t('tableClient')}</th>
                <th className="px-3 py-2">{t('tableToolMethod')}</th>
                <th className="px-3 py-2">{t('tableResult')}</th>
                <th className="px-3 py-2">{t('tableCorrelation')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 text-xs">
                    {format.dateTime(new Date(row.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">{row.actorType}</td>
                  <td
                    className="px-3 py-2 text-xs font-mono"
                    title={row.userAgent ?? undefined}
                  >
                    {row.client}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">{row.tool ?? row.method ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        row.result === 'ok'
                          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700'
                          : row.result === 'denied'
                            ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700'
                            : 'rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700'
                      }
                    >
                      {row.result ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                    {row.correlationId?.slice(0, 8) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!exhausted && items.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void load(false, filters, cursor)}>
            {t('loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}
