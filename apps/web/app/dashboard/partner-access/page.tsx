'use client';

import { useEffect, useState } from 'react';
import { Building2, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface OrgDto {
  id: string;
  name: string;
  slug: string;
  partnerId: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
}

export default function PartnerAccessPage() {
  const [org, setOrg] = useState<OrgDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  async function load() {
    try {
      setError(null);
      const me = await api<OrgDto>('/api/orgs/me');
      setOrg(me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load org info.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke() {
    if (!confirm('Revoke partner access? Any admin keys the partner provisioned will stop working immediately. Your data and direct password remain.')) {
      return;
    }
    setRevoking(true);
    try {
      await api('/api/orgs/me/partner-access', { method: 'DELETE' });
      setRevoked(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke partner access.');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Partner access</h1>
        <p className="text-sm text-muted-foreground">
          When a partner provisions your Munin org on your behalf (e.g. during signup with a voice
          AI provider), they hold an admin API key for it. You can revoke that access at any time —
          your data and your direct dashboard login stay.
        </p>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {revoked && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="py-3 text-sm text-emerald-900">
            Partner access revoked. The partner&apos;s provisioned admin keys are now invalid.
          </CardContent>
        </Card>
      )}

      {org === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : org.partnerId ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="size-5 text-muted-foreground" />
              <CardTitle>Connected partner</CardTitle>
            </div>
            <CardDescription>
              Your org was provisioned by partner <code className="font-mono">{org.partnerId}</code>.
              They can manage this org via the partner API; you can also use Munin directly with
              your password and any admin keys you mint yourself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => void revoke()} disabled={revoking}>
              <ShieldAlert className="size-4" />
              {revoking ? 'Revoking…' : 'Revoke partner access'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="size-5 text-muted-foreground" />
              <CardTitle>No partner connected</CardTitle>
            </div>
            <CardDescription>
              You created this org directly. There&apos;s nothing to revoke. If you signed up
              through an integration partner, this page is where you&apos;d disconnect them.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </>
  );
}
