'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';
import { api, ApiError } from '../api';

interface ProposalContactSummary {
  id: string;
  name: string | null;
  email: string | null;
  companyId: string | null;
}

interface ProposalCampaignSummary {
  id: string;
  name: string;
}

interface ProposalDto {
  id: string;
  campaignId: string;
  contactId: string;
  conversationId: string | null;
  kind: 'initial' | 'reply';
  draftSubject: string | null;
  draftBody: string;
  evidence: Record<string, unknown>;
  proposedSendAt: string | null;
  status: 'pending' | 'approved' | 'sent' | 'failed' | 'dismissed';
  createdAt: string;
  updatedAt: string;
  contact: ProposalContactSummary | null;
  campaign: ProposalCampaignSummary | null;
}

const POLL_MS = 60_000;

function FlattenedHeading({ children }: { children?: React.ReactNode }) {
  return <p className="font-semibold">{children}</p>;
}

const MARKDOWN_COMPONENTS: Components = {
  h1: FlattenedHeading,
  h2: FlattenedHeading,
  h3: FlattenedHeading,
  h4: FlattenedHeading,
  h5: FlattenedHeading,
  h6: FlattenedHeading,
};

interface OutreachDraftsTabProps {
  onCountChange?: (count: number) => void;
}

export function OutreachDraftsTab({ onCountChange }: OutreachDraftsTabProps) {
  const t = useTranslations('dashboard.outreachDrafts');
  const format = useFormatter();
  const [proposals, setProposals] = useState<ProposalDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await api<{ items: ProposalDto[] }>(
        '/api/outreach/proposals?status=pending&limit=200',
      );
      setProposals(list.items);
      onCountChange?.(list.items.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.load'));
    }
  }, [t, onCountChange]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function approve(p: ProposalDto) {
    setBusyId(p.id);
    try {
      await api(`/api/outreach/proposals/${p.id}/approve`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.approve'));
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(p: ProposalDto) {
    const reason = window.prompt(t('dismissPrompt')) ?? undefined;
    setBusyId(p.id);
    try {
      await api(`/api/outreach/proposals/${p.id}/dismiss`, {
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

  if (proposals === null) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {proposals.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyBody')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {proposals.map((p) => {
            const contact = p.contact;
            const campaign = p.campaign;
            const updatedLabel = format.dateTime(new Date(p.updatedAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            return (
              <Card key={p.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-base">
                        {p.draftSubject ?? t('untitled')}
                      </CardTitle>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge
                          variant={p.kind === 'reply' ? 'secondary' : 'outline'}
                          className="capitalize"
                        >
                          {p.kind}
                        </Badge>
                        <span>{updatedLabel}</span>
                        {campaign && (
                          <span>
                            {t('via')} <strong className="font-medium">{campaign.name}</strong>
                          </span>
                        )}
                        {contact && (
                          <span>
                            {t('to')}{' '}
                            <strong className="font-medium">
                              {contact.name ?? contact.email ?? contact.id}
                            </strong>
                            {contact.email && contact.name && (
                              <span className="text-muted-foreground"> ({contact.email})</span>
                            )}
                          </span>
                        )}
                        {p.kind === 'reply' && p.conversationId && (
                          <a
                            href={`/dashboard/conversations?id=${p.conversationId}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {t('viewThread')}
                          </a>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() => void approve(p)}
                        disabled={busyId === p.id}
                      >
                        <Check className="size-4" />
                        {t('approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => alert(t('editComingSoon'))}
                        disabled={busyId === p.id}
                      >
                        <Pencil className="size-4" />
                        {t('edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void dismiss(p)}
                        disabled={busyId === p.id}
                      >
                        <X className="size-4" />
                        {t('dismiss')}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none rounded-md border bg-muted/30 p-3 dark:prose-invert">
                    <ReactMarkdown components={MARKDOWN_COMPONENTS}>{p.draftBody}</ReactMarkdown>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
