'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
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

interface DocSummary {
  id: string;
  spaceId: string;
  title: string;
  audiences: string[];
  version: number;
  tags: string[];
  updatedAt: string;
  proposedTargetSpaceSlug: string | null;
  sourceConversationId: string | null;
}

interface DocDetail extends DocSummary {
  body: string;
  slug: string | null;
}

interface SpaceDto {
  id: string;
  slug: string;
  name: string;
  audiences: string[];
}

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

const POLL_MS = 60_000;
const PREFERRED_TARGET_SLUG = 'support-faq';
const CURATION_INBOX_SLUG = 'kb-curation-inbox';

interface KbCandidatesTabProps {
  onCountChange?: (count: number) => void;
}

export function KbCandidatesTab({ onCountChange }: KbCandidatesTabProps) {
  const t = useTranslations('dashboard.kbCandidates');
  const format = useFormatter();
  const [candidates, setCandidates] = useState<DocSummary[] | null>(null);
  const [details, setDetails] = useState<Record<string, DocDetail>>({});
  const [spaces, setSpaces] = useState<SpaceDto[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const promotableSpaces = useMemo(
    () => (spaces ?? []).filter((s) => s.slug !== CURATION_INBOX_SLUG),
    [spaces],
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const [candList, spaceList] = await Promise.all([
        api<{ items: DocSummary[] }>('/api/kb/curation/candidates'),
        api<SpaceDto[]>('/api/kb/spaces').catch(() => [] as SpaceDto[]),
      ]);
      setCandidates(candList.items);
      setSpaces(spaceList);
      onCountChange?.(candList.items.length);
      const detailEntries = await Promise.all(
        candList.items.map(async (c) => {
          try {
            return [c.id, await api<DocDetail>(`/api/kb/curation/candidates/${c.id}`)] as const;
          } catch {
            return null;
          }
        }),
      );
      setDetails(
        Object.fromEntries(detailEntries.filter((e): e is [string, DocDetail] => e !== null)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.load'));
    }
  }, [t, onCountChange]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  function resolveTargetSlug(candidate: DocSummary): string {
    const override = overrides[candidate.id];
    if (override) return override;
    const proposed = candidate.proposedTargetSpaceSlug;
    if (proposed) return proposed;
    const preferred = promotableSpaces.find((s) => s.slug === PREFERRED_TARGET_SLUG);
    return preferred?.slug ?? promotableSpaces[0]?.slug ?? '';
  }

  async function approve(candidate: DocSummary) {
    const id = candidate.id;
    const targetSlug = resolveTargetSlug(candidate);
    if (!targetSlug) {
      setError(t('errors.noSpace'));
      return;
    }
    setBusyId(id);
    try {
      await api(`/api/kb/curation/candidates/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ targetSpaceSlug: targetSlug }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.approve'));
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    if (!confirm(t('dismissConfirm'))) return;
    setBusyId(id);
    try {
      await api(`/api/kb/curation/candidates/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.dismiss'));
    } finally {
      setBusyId(null);
    }
  }

  if (candidates === null) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {candidates.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyBody')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {candidates.map((c) => {
            const detail = details[c.id];
            const sourceConvId = c.sourceConversationId;
            const updatedLabel = format.dateTime(new Date(c.updatedAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            const targetSlug = resolveTargetSlug(c);
            const body = detail?.body ?? '';
            return (
              <Card key={c.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-base">{c.title}</CardTitle>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">v{c.version}</Badge>
                        <span>{updatedLabel}</span>
                        {sourceConvId && (
                          <a
                            href={`/dashboard/conversations?id=${sourceConvId}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {t('sourceConvLink', { id: sourceConvId.slice(-8) })}
                          </a>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() => void approve(c)}
                        disabled={busyId === c.id || !targetSlug}
                      >
                        <Check className="size-4" />
                        {t('approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void dismiss(c.id)}
                        disabled={busyId === c.id}
                      >
                        <X className="size-4" />
                        {t('dismiss')}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {detail && (
                  <CardContent className="space-y-3">
                    <div className="prose prose-sm max-w-none rounded-md border bg-muted/30 p-3 dark:prose-invert">
                      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{body}</ReactMarkdown>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{t('publishTo')}</span>
                      <div className="relative inline-block">
                        <select
                          value={targetSlug}
                          onChange={(e) =>
                            setOverrides((prev) => ({ ...prev, [c.id]: e.target.value }))
                          }
                          className="appearance-none rounded-md border border-input bg-background pl-2 pr-7 py-1 text-xs text-foreground"
                        >
                          {targetSlug &&
                            !promotableSpaces.some((s) => s.slug === targetSlug) && (
                              <option value={targetSlug}>
                                {t('willCreate', { slug: targetSlug })}
                              </option>
                            )}
                          {promotableSpaces.map((s) => (
                            <option key={s.id} value={s.slug}>
                              {s.name} ({s.slug})
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
