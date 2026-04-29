'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { api, ApiError } from '../api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@munin/ui';
import { cn } from '@munin/ui';

interface UsageDto {
  minute: { used: number; limit: number; resetAt: string };
  day: { used: number; limit: number; resetAt: string };
}

export function UsagePage() {
  const [usage, setUsage] = useState<UsageDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const u = await api<UsageDto>('/api/usage');
        if (active) {
          setUsage(u);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load usage.');
      }
    }
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-muted-foreground">
          MCP tool calls counted against your tier limits. Counters reset at the start of each
          window.
        </p>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {usage && (
        <div className="grid gap-4 md:grid-cols-2">
          <UsageCard label="Per minute" data={usage.minute} />
          <UsageCard label="Per day" data={usage.day} />
        </div>
      )}
    </>
  );
}

function UsageCard({
  label,
  data,
}: {
  label: string;
  data: { used: number; limit: number; resetAt: string };
}) {
  const pct = data.limit === 0 ? 0 : Math.min(100, Math.round((data.used / data.limit) * 100));
  const tone = pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="size-5 text-muted-foreground" />
          <CardTitle className="text-base">{label}</CardTitle>
        </div>
        <CardDescription>
          {data.used} of {data.limit} tool calls — resets {formatResetIn(data.resetAt)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full transition-all', tone)} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{pct}% used</p>
      </CardContent>
    </Card>
  );
}

function formatResetIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 'now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `in ${hours}h`;
}
