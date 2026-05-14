'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@getmunin/ui';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';

const JOB_URI = 'task://web/scrape-site';

interface CuratorJobDto {
  id: string;
}

interface EnqueueResponse {
  job: CuratorJobDto;
  alreadyPending: boolean;
}

export interface WebsiteImportCardProps {
  onEnqueued: (jobId: string) => void;
  onSkip: () => void;
  onBack?: () => void;
}

export function WebsiteImportCard({ onEnqueued, onSkip, onBack }: WebsiteImportCardProps) {
  const t = useTranslations('agentSetup.websiteImport');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeUrl(url);
  const canSubmit = normalized !== null && !submitting;

  async function submit() {
    if (!canSubmit || !normalized) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<EnqueueResponse>('/api/v1/curation/jobs', {
        method: 'POST',
        body: JSON.stringify({
          jobUri: JOB_URI,
          userPrompt: normalized,
          dedupeKey: `onboarding-import:${normalized}`,
          maxAttempts: 3,
        }),
      });
      onEnqueued(res.job.id);
    } catch (err) {
      setError(translate(err) || t('errors.enqueue'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('lede')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="websiteUrl">{t('urlLabel')}</Label>
          <Input
            id="websiteUrl"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            autoFocus
            inputMode="url"
            autoComplete="url"
          />
          <p className="text-xs text-muted-foreground">{t('urlHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? tCommon('saving') : t('import')}
          </Button>
          <Button type="button" variant="outline" onClick={onSkip} disabled={submitting}>
            {t('skip')}
          </Button>
          {onBack && (
            <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
              {tCommon('back')}
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length < 4) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProtocol);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch (err) {
    console.debug('[website-import] could not parse URL', { input, err });
    return null;
  }
}
