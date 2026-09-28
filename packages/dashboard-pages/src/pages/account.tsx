'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button, Hero, Input } from '@getmunin/ui';
import { api } from '../api';
import { invalidateActiveMembershipCache } from '../auth/use-active-role';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { Skeleton } from '../components/skeleton';
import {
  SaveButton,
  SettingsColumn,
  SettingsFieldNote,
  SettingsLabel,
  SettingsSection,
  SETTINGS_MEASURE_FIELD,
} from '../components/settings/scaffold';
import { prepareImageForUpload } from '../lib/upload-image';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

interface OrgDto {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  logoUrl: string | null;
  createdAt: string;
}

const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

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
    const data = await api<OrgDto>('/v1/orgs/me');
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
      const updated = await api<OrgDto>('/v1/orgs/me', {
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
    <SettingsColumn>
      <Hero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('subtitle')}
      />

      <SettingsSection title={t('orgSectionTitle')} meta={t('orgSectionMeta')}>
        {org === null ? (
          <div role="status" aria-busy="true" className="space-y-4">
            <span className="sr-only">{tCommon('loading')}</span>
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-9 w-24" />
          </div>
        ) : (
          <form className="space-y-5" onSubmit={(e) => void submit(e)}>
            <div className="space-y-2">
              <SettingsLabel htmlFor="org-name">{t('orgNameLabel')}</SettingsLabel>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('orgNamePlaceholder')}
                maxLength={128}
                disabled={saving}
                aria-invalid={error ? true : undefined}
                className={SETTINGS_MEASURE_FIELD}
              />
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : (
                <SettingsFieldNote>{t('orgNameHint')}</SettingsFieldNote>
              )}
            </div>

            <div className="flex items-center gap-3">
              <SaveButton
                type="submit"
                dirty={dirty}
                saving={saving}
                label={tCommon('save')}
                savingLabel={tCommon('saving')}
              />
              {savedAt && !dirty && !error ? (
                <span key={savedAt} className="text-sm text-ink-mute">
                  {tCommon('saved')}
                </span>
              ) : null}
            </div>
          </form>
        )}
      </SettingsSection>

      {org ? <OrgLogoSection org={org} onChange={setOrg} /> : null}

      {extraSections}
    </SettingsColumn>
  );
}

function OrgLogoSection({ org, onChange }: { org: OrgDto; onChange: (next: OrgDto) => void }) {
  const t = useTranslations('dashboard.account');
  const translate = useTranslateError();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (busy) return;
    setBusy('upload');
    setError(null);
    try {
      const prepared = await prepareImageForUpload(file);
      if (prepared.blob.size > LOGO_MAX_BYTES) {
        setError(translate({ code: 'org_logo_too_large' }) || t('logoErrors.upload'));
        return;
      }
      const updated = await api<OrgDto>('/v1/orgs/me/logo', {
        method: 'PUT',
        body: prepared.blob,
        headers: { 'Content-Type': prepared.mime },
      });
      onChange(updated);
    } catch (err) {
      setError(translate(err) || t('logoErrors.upload'));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy('remove');
    setError(null);
    try {
      onChange(await api<OrgDto>('/v1/orgs/me/logo', { method: 'DELETE' }));
    } catch (err) {
      setError(translate(err) || t('logoErrors.remove'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsSection title={t('logoSectionTitle')} meta={t('logoSectionMeta')}>
      <div className="space-y-4">
        <SettingsLabel htmlFor="org-logo">{t('logoLabel')}</SettingsLabel>
        <div className="flex items-center gap-4">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden border-[1px] border-rule-soft bg-paper-deep dark:border-rule-on-dark dark:bg-secondary">
            {org.logoUrl ? (
              <img src={org.logoUrl} alt={t('logoAlt')} className="size-full object-contain" />
            ) : (
              <span className="px-2 text-center text-xs text-ink-mute">{t('logoEmpty')}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={busy !== null}
            >
              {busy === 'upload'
                ? t('logoUploading')
                : org.logoUrl
                  ? t('logoReplace')
                  : t('logoUpload')}
            </Button>
            {org.logoUrl ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void remove()}
                disabled={busy !== null}
              >
                {busy === 'remove' ? t('logoRemoving') : t('logoRemove')}
              </Button>
            ) : null}
          </div>
        </div>
        <input
          ref={inputRef}
          id="org-logo"
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : (
          <SettingsFieldNote>{t('logoHint')}</SettingsFieldNote>
        )}
      </div>
    </SettingsSection>
  );
}
