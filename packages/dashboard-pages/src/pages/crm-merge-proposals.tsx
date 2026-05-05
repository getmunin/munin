'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Users, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@getmunin/ui';
import { api, ApiError } from '../api';
import { useRealtime } from '../realtime';

interface ContactSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  companyId: string | null;
  endUserId: string | null;
}

interface MergeProposalDto {
  id: string;
  contactA: ContactSummary;
  contactB: ContactSummary;
  confidence: 'high' | 'medium';
  evidence: Record<string, unknown>;
  recommendedKeeperId: string;
  recommendedPatch: Record<string, unknown>;
  status: 'pending' | 'applied' | 'dismissed';
  dismissReason: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

interface ListResponse {
  items: MergeProposalDto[];
}

const POLL_MS = 60_000;

export function CrmMergeProposalsPage() {
  const t = useTranslations('dashboard.crmMergeProposals');
  const [proposals, setProposals] = useState<MergeProposalDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api<ListResponse>('/api/crm/merge-proposals?status=pending&limit=200');
      setProposals(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.load'));
    }
  }, [t]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useRealtime([{ channel: 'org' }], (event) => {
    if (event.type.startsWith('crm.merge_proposal.')) {
      void load();
    }
  });

  async function apply(id: string) {
    setBusyId(id);
    try {
      await api(`/api/crm/merge-proposals/${id}/apply`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.apply'));
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    const reason = window.prompt(t('dismissPrompt')) ?? undefined;
    setBusyId(id);
    try {
      await api(`/api/crm/merge-proposals/${id}/dismiss`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.dismiss'));
    } finally {
      setBusyId(null);
    }
  }

  const empty = useMemo(() => proposals !== null && proposals.length === 0, [proposals]);

  return (
    <div className="space-y-4">
      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {proposals === null && !error && (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      )}

      {empty && (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyBody')}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {proposals && proposals.length > 0 && (
        <ul className="space-y-3">
          {proposals.map((p) => {
            const keeper = p.contactA.id === p.recommendedKeeperId ? p.contactA : p.contactB;
            const dup = p.contactA.id === p.recommendedKeeperId ? p.contactB : p.contactA;
            const confLabel =
              p.confidence === 'high' ? t('confidence.high') : t('confidence.medium');
            return (
              <li key={p.id}>
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Users className="size-5 text-muted-foreground" />
                      <CardTitle className="text-base">
                        {contactLabel(keeper)} <span className="text-muted-foreground">↔</span>{' '}
                        {contactLabel(dup)}
                      </CardTitle>
                      <span
                        className={
                          p.confidence === 'high'
                            ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200'
                            : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
                        }
                      >
                        {confLabel}
                      </span>
                    </div>
                    <CardDescription>{t('proposedAt', { date: formatDate(p.createdAt) })}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <ContactCard label={t('keeperLabel')} contact={keeper} highlight />
                      <ContactCard label={t('duplicateLabel')} contact={dup} />
                    </div>
                    {Object.keys(p.evidence).length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          {t('evidenceToggle')}
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded border bg-muted px-3 py-2">
                          {JSON.stringify(p.evidence, null, 2)}
                        </pre>
                      </details>
                    )}
                    {Object.keys(p.recommendedPatch).length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          {t('patchToggle')}
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded border bg-muted px-3 py-2">
                          {JSON.stringify(p.recommendedPatch, null, 2)}
                        </pre>
                      </details>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={busyId === p.id}
                        onClick={() => void apply(p.id)}
                      >
                        <CheckCircle2 className="size-4" />
                        {t('applyButton')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === p.id}
                        onClick={() => void dismiss(p.id)}
                      >
                        <X className="size-4" />
                        {t('dismissButton')}
                      </Button>
                      {busyId === p.id && (
                        <span className="text-xs text-muted-foreground">{t('working')}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {!empty && proposals && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="size-3" />
          {t('hint')}
        </p>
      )}
    </div>
  );
}

function ContactCard({
  label,
  contact,
  highlight,
}: {
  label: string;
  contact: ContactSummary;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? 'rounded-md border-2 border-emerald-300 bg-emerald-50/40 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950/30'
          : 'rounded-md border bg-muted/30 px-3 py-2'
      }
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{contact.name ?? contact.id}</p>
      <p className="text-xs text-muted-foreground">{contact.email ?? '—'}</p>
      <p className="text-xs text-muted-foreground">{contact.phone ?? '—'}</p>
      <p className="font-mono text-[10px] text-muted-foreground">{contact.id}</p>
    </div>
  );
}

function contactLabel(c: ContactSummary): string {
  return c.name ?? c.email ?? c.id;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
