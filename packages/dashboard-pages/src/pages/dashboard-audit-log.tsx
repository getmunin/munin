'use client';

import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { api, ApiError } from '../api';
import { Button } from '@munin/ui';
import { Input } from '@munin/ui';
import { Label } from '@munin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@munin/ui';

interface AuditDto {
  id: string;
  actorType: string;
  actorId: string | null;
  tool: string | null;
  method: string | null;
  result: string | null;
  error: string | null;
  correlationId: string | null;
  createdAt: string;
}

interface AuditPage {
  items: AuditDto[];
  nextCursor: string | null;
}

export function AuditLogPage() {
  const [items, setItems] = useState<AuditDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ tool: '', actorType: '', correlationId: '' });

  async function load(reset: boolean) {
    try {
      const params = new URLSearchParams();
      if (filters.tool) params.set('tool', filters.tool);
      if (filters.actorType) params.set('actorType', filters.actorType);
      if (filters.correlationId) params.set('correlationId', filters.correlationId);
      if (!reset && cursor) params.set('before', cursor);
      const page = await api<AuditPage>(`/api/audit-log?${params.toString()}`);
      setError(null);
      if (reset) {
        setItems(page.items);
      } else {
        setItems((prev) => [...prev, ...page.items]);
      }
      setCursor(page.nextCursor);
      setExhausted(page.nextCursor === null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load audit log.');
    }
  }

  useEffect(() => {
    void load(true);

  }, []);

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every tool call and control-plane mutation, newest first. Filter by tool, actor type, or
          correlation id to isolate one request chain.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
          <CardDescription>Leave blank to match all values.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              setCursor(null);
              setExhausted(false);
              void load(true);
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="tool">Tool</Label>
              <Input
                id="tool"
                value={filters.tool}
                onChange={(e) => setFilters((f) => ({ ...f, tool: e.target.value }))}
                placeholder="kb_search"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="actorType">Actor type</Label>
              <Input
                id="actorType"
                value={filters.actorType}
                onChange={(e) => setFilters((f) => ({ ...f, actorType: e.target.value }))}
                placeholder="admin_agent"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="correlationId">Correlation id</Label>
              <Input
                id="correlationId"
                value={filters.correlationId}
                onChange={(e) => setFilters((f) => ({ ...f, correlationId: e.target.value }))}
                placeholder="uuid"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Apply
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
              <CardTitle>No audit rows yet</CardTitle>
            </div>
            <CardDescription>
              Tool calls and control-plane writes appear here. Connect an agent and try a tool.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs font-medium uppercase text-muted-foreground">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Tool / method</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 text-xs">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs font-mono">{row.actorType}</td>
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
          <Button variant="outline" onClick={() => void load(false)}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
