'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { ApiError } from '../api';
import { Button } from '@getmunin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function ExportPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/export`, { credentials: 'include' });
      if (!res.ok) {
        throw new ApiError(res.status, await res.text());
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `munin-export-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate export.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Data export</h1>
        <p className="text-sm text-muted-foreground">
          Download a complete JSON dump of your org&apos;s domain data — knowledge base, end-users,
          suggestions, and configuration. Use this to migrate to a self-hosted Munin or to keep an
          offline copy.
        </p>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Export now</CardTitle>
          <CardDescription>
            Includes: organization, end-users, agents, KB spaces / documents / versions, and
            suggestions. Excludes: tokens, API keys, and the audit log (those are operational data
            you can&apos;t restore from an export).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void download()} disabled={loading}>
            <Download className="size-4" />
            {loading ? 'Preparing…' : 'Download export'}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
