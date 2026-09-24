'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Hero } from '@getmunin/ui';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { NativeSelect } from '../components/native-select';
import { Skeleton } from '../components/skeleton';
import {
  CheckboxRow,
  RadioRow,
  SaveButton,
  SettingsColumn,
  SettingsFieldNote,
  SettingsLabel,
  SettingsSection,
  SETTINGS_MEASURE_FIELD,
} from '../components/settings/scaffold';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';

type Detector = 'no_fnr' | 'se_pnr' | 'dk_cpr';
type Policy = 'off' | 'mask' | 'remove';
type Confidence = 'high' | 'medium';

interface RedactionPolicyDto {
  detectors: Detector[];
  policy: Policy;
  minConfidence: Confidence;
  configured: boolean;
  availableDetectors: Detector[];
}

const POLICIES: Policy[] = ['remove', 'mask', 'off'];
const CONFIDENCES: Confidence[] = ['high', 'medium'];
const FUZZY_DETECTORS: Detector[] = ['se_pnr', 'dk_cpr'];

export function PrivacyPage() {
  const t = useTranslations('dashboard.privacy');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [loaded, setLoaded] = useState<RedactionPolicyDto | null>(null);
  const [detectors, setDetectors] = useState<Detector[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [minConfidence, setMinConfidence] = useState<Confidence>('high');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const data = await api<RedactionPolicyDto>('/v1/conversations/redaction');
    setLoaded(data);
    setDetectors(data.detectors);
    setPolicy(data.configured ? data.policy : null);
    setMinConfidence(data.minConfidence);
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  const dirty =
    !!loaded &&
    policy !== null &&
    (!loaded.configured ||
      policy !== loaded.policy ||
      minConfidence !== loaded.minConfidence ||
      detectors.length !== loaded.detectors.length ||
      detectors.some((d) => !loaded.detectors.includes(d)));

  const confidenceApplies = detectors.some((d) => FUZZY_DETECTORS.includes(d));

  function toggle(detector: Detector) {
    setDetectors((current) =>
      current.includes(detector) ? current.filter((d) => d !== detector) : [...current, detector],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving || policy === null) return;
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
    <SettingsColumn>
      <Hero
        eyebrow={t('eyebrow')}
        title={t.rich('title', { em: (chunks) => <em>{chunks}</em> })}
        lede={t('subtitle')}
      />

      <SettingsSection
        title={t('sectionTitle')}
        meta={
          loaded
            ? t('sectionMeta', { count: detectors.length, total: loaded.availableDetectors.length })
            : undefined
        }
        help={t('detectorsHint')}
      >
        {loaded === null ? (
          <div role="status" aria-busy="true" className="space-y-4">
            <span className="sr-only">{tCommon('loading')}</span>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-24" />
          </div>
        ) : (
          <form className="space-y-5" onSubmit={(e) => void submit(e)}>
            <div>
              {loaded.availableDetectors.map((detector) => (
                <CheckboxRow
                  key={detector}
                  checked={detectors.includes(detector)}
                  onChange={() => toggle(detector)}
                  disabled={saving}
                  title={t(`detectors.${detector}.name`)}
                  description={t(`detectors.${detector}.hint`)}
                />
              ))}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-[12.5px] font-semibold text-ink dark:text-foreground">
                {t('policyLabel')}
              </legend>
              {loaded.configured ? null : <SettingsFieldNote>{t('policyPickHint')}</SettingsFieldNote>}
              <div>
                {POLICIES.map((option) => (
                  <RadioRow
                    key={option}
                    name="redaction-policy"
                    checked={policy === option}
                    onChange={() => setPolicy(option)}
                    disabled={saving}
                    title={t(`policies.${option}`)}
                    description={t(`policyHint.${option}`)}
                  />
                ))}
              </div>
            </fieldset>

            {confidenceApplies ? (
              <div className="space-y-2">
                <SettingsLabel htmlFor="redaction-confidence">
                  {t('confidenceLabel')}
                </SettingsLabel>
                <NativeSelect
                  id="redaction-confidence"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(e.target.value as Confidence)}
                  disabled={saving}
                  wrapperClassName={SETTINGS_MEASURE_FIELD}
                >
                  {CONFIDENCES.map((option) => (
                    <option key={option} value={option}>
                      {t(`confidences.${option}`)}
                    </option>
                  ))}
                </NativeSelect>
                <SettingsFieldNote>
                  {t(`confidenceHint.${minConfidence}`)} {t('scopeNote')}
                </SettingsFieldNote>
              </div>
            ) : (
              <SettingsFieldNote>{t('scopeNote')}</SettingsFieldNote>
            )}

            {loaded.configured ? null : (
              <p className="flex max-w-[520px] items-start gap-2.5 text-[12.5px] leading-[1.45] text-ink dark:text-foreground">
                <span
                  aria-hidden
                  className="mt-[5px] size-[7px] shrink-0 rounded-full bg-amber-500 dark:bg-amber-400"
                />
                {t('unconfiguredNote')}
              </p>
            )}

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <SaveButton
                type="submit"
                dirty={dirty}
                saving={saving}
                label={tCommon('save')}
                savingLabel={tCommon('saving')}
              />
              {policy === null ? (
                <span className="text-sm text-ink-mute">{t('choosePolicyFirst')}</span>
              ) : null}
              {savedAt && !dirty && !error ? (
                <span key={savedAt} className="text-sm text-ink-mute">
                  {tCommon('saved')}
                </span>
              ) : null}
            </div>
          </form>
        )}
      </SettingsSection>
    </SettingsColumn>
  );
}
