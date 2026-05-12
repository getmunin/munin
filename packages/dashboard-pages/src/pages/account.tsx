'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Hero, Input, SectionHead, cn } from '@getmunin/ui';
import { api } from '../api';
import { invalidateActiveMembershipCache } from '../auth/use-active-role';
import { useTranslateError } from '../i18n/translate-error';
import { FormField } from '../components/form-field';
import { LoadFailed } from '../components/load-failed';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

interface OrgDto {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  createdAt: string;
}

export interface AccountPageProps {
  extraSections?: ReactNode;
}

export function AccountPage({ extraSections }: AccountPageProps) {
  const t = useTranslations('dashboard.account');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [org, setOrg] = useState<OrgDto | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const data = await api<OrgDto>('/api/v1/orgs/me');
    setOrg(data);
    setName(data.name);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  const trimmed = name.trim();
  const dirty = !!org && trimmed.length > 0 && trimmed !== org.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api<OrgDto>('/api/v1/orgs/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      invalidateActiveMembershipCache();
      setOrg(updated);
      setName(updated.name);
      setSavedAt(Date.now());
    } catch (err) {
      setError(translate(err) || t('errors.save'));
    } finally {
      setSaving(false);
    }
  }

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed
        {...buildLoadFailedProps('settings', loadError, () => void retry(), retrying)}
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

      <section className="space-y-4">
        <SectionHead title={t('orgSectionTitle')} divider={false} />

        <form className="max-w-md space-y-4" onSubmit={(e) => void submit(e)}>
          <FormField label={t('orgNameLabel')} hint={t('orgNameHint')} error={error}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('orgNamePlaceholder')}
              maxLength={128}
              disabled={!org || saving}
              aria-invalid={error ? true : undefined}
            />
          </FormField>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!dirty || saving}>
              {saving ? tCommon('saving') : tCommon('saveChanges')}
            </Button>
            {savedAt && !dirty && !error ? (
              <span
                key={savedAt}
                className={cn(
                  'font-mono text-[10px] uppercase tracking-eyebrow text-cobalt dark:text-cobalt-soft',
                )}
              >
                {t('saved')}
              </span>
            ) : null}
          </div>
        </form>
      </section>

      {extraSections}
    </>
  );
}
