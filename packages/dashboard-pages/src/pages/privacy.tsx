'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Hero, SectionHead } from '@getmunin/ui';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { FormField } from '../components/form-field';
import { LoadFailed } from '../components/load-failed';
import { NativeSelect } from '../components/native-select';
import { Skeleton } from '../components/skeleton';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

type Detector = 'no_fnr' | 'se_pnr' | 'dk_cpr';
type Policy = 'off' | 'mask' | 'remove';
type Confidence = 'high' | 'medium';

interface RedactionPolicyDto {
  detectors: Detector[];
  policy: Policy;
  minConfidence: Confidence;
  availableDetectors: Detector[];
}

const POLICIES: Policy[] = ['off', 'mask', 'remove'];
const CONFIDENCES: Confidence[] = ['high', 'medium'];

export function PrivacyPage() {
  const t = useTranslations('dashboard.privacy');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [loaded, setLoaded] = useState<RedactionPolicyDto | null>(null);
  const [detectors, setDetectors] = useState<Detector[]>([]);
  const [policy, setPolicy] = useState<Policy>('off');
  const [minConfidence, setMinConfidence] = useState<Confidence>('high');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const data = await api<RedactionPolicyDto>('/v1/conversations/redaction');
    setLoaded(data);
    setDetectors(data.detectors);
    setPolicy(data.policy);
    setMinConfidence(data.minConfidence);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  const dirty =
    !!loaded &&
    (policy !== loaded.policy ||
      minConfidence !== loaded.minConfidence ||
      detectors.length !== loaded.detectors.length ||
      detectors.some((d) => !loaded.detectors.includes(d)));

  function toggle(detector: Detector) {
    setDetectors((current) =>
      current.includes(detector) ? current.filter((d) => d !== detector) : [...current, detector],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api<RedactionPolicyDto>('/v1/conversations/redaction', {
        method: 'PUT',
        body: JSON.stringify({ detectors, policy, minConfidence }),
      });
      setLoaded(updated);
      setDetectors(updated.detectors);
      setPolicy(updated.policy);
      setMinConfidence(updated.minConfidence);
      setSavedAt(Date.now());
    } catch (err) {
      setError(translate(err) || t('errors.save'));
    } finally {
      setSaving(false);
    }
  }

  if (loadError && !hasLoadedOnce) {
    return (
      <LoadFailed {...buildLoadFailedProps('settings', loadError, () => void retry(), retrying)} />
    );
  }

  return (
    <div className="max-w-3xl space-y-10">
      <Hero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('subtitle')}
      />

      <section className="space-y-4">
        <SectionHead title={t('sectionTitle')} divider={false} />

        {loaded === null ? (
          <div role="status" aria-busy="true" className="space-y-4">
            <span className="sr-only">{tCommon('loading')}</span>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-24" />
          </div>
        ) : (
          <form className="space-y-6" onSubmit={(e) => void submit(e)}>
            <FormField label={t('detectorsLabel')} hint={t('detectorsHint')}>
              <div className="space-y-1">
                {loaded.availableDetectors.map((detector) => (
                  <label
                    key={detector}
                    className="flex cursor-pointer items-start gap-3 border-b-[1px] border-rule-soft py-2.5 last:border-0 dark:border-rule-on-dark"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0"
                      checked={detectors.includes(detector)}
                      onChange={() => toggle(detector)}
                      disabled={saving}
                    />
                    <span className="flex flex-1 flex-col gap-1">
                      <span className="text-ink dark:text-foreground">
                        {t(`detectors.${detector}.name`)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t(`detectors.${detector}.hint`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </FormField>

            <FormField label={t('policyLabel')} hint={t(`policyHint.${policy}`)} error={error}>
              <NativeSelect
                value={policy}
                onChange={(e) => setPolicy(e.target.value as Policy)}
                disabled={saving}
              >
                {POLICIES.map((option) => (
                  <option key={option} value={option}>
                    {t(`policies.${option}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            <FormField label={t('confidenceLabel')} hint={t(`confidenceHint.${minConfidence}`)}>
              <NativeSelect
                value={minConfidence}
                onChange={(e) => setMinConfidence(e.target.value as Confidence)}
                disabled={saving}
              >
                {CONFIDENCES.map((option) => (
                  <option key={option} value={option}>
                    {t(`confidences.${option}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            <p className="text-sm text-muted-foreground">{t('scopeNote')}</p>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!dirty || saving}>
                {saving ? tCommon('saving') : tCommon('save')}
              </Button>
              {savedAt && !dirty && !error ? (
                <span key={savedAt} className="text-sm text-muted-foreground">
                  {tCommon('saved')}
                </span>
              ) : null}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
