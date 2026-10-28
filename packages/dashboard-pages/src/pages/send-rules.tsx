'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Hero, Input } from '@getmunin/ui';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { LoadFailed } from '../components/load-failed';
import { NativeSelect } from '../components/native-select';
import { Skeleton } from '../components/skeleton';
import {
  CheckboxRow,
  SaveButton,
  SettingsColumn,
  SettingsFieldNote,
  SettingsLabel,
  SettingsSection,
  SETTINGS_MEASURE_FIELD,
} from '../components/settings/scaffold';
import { useLoadGate } from '../lib/use-load-gate';
import { useSettingsLoadFailedProps } from '../lib/use-load-failed-props';
import {
  WEEKDAYS,
  formFromRules,
  recommendedForm,
  rulesFromForm,
  sameRules,
  timeZoneOptions,
  type SendRulesDto,
  type SendRulesForm,
  type Weekday,
} from '../lib/send-rules-form';

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function SendRulesPage() {
  const t = useTranslations('dashboard.sendRules');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [loaded, setLoaded] = useState<SendRulesDto | null>(null);
  const [form, setForm] = useState<SendRulesForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const data = await api<SendRulesDto>('/v1/outreach/send-rules');
    setLoaded(data);
    setForm(formFromRules(data, data.recommended));
  }, []);

  const { loadError, hasLoadedOnce, retrying, tryLoad, retry } = useLoadGate(load);
  const buildLoadFailedProps = useSettingsLoadFailedProps();

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  const zones = useMemo(() => timeZoneOptions(form?.timezone ?? 'UTC'), [form?.timezone]);
  const parsed = form ? rulesFromForm(form) : null;
  const dirty =
    !!loaded && !!parsed && 'rules' in parsed && (!loaded.configured || !sameRules(parsed.rules, loaded));

  function patch(next: Partial<SendRulesForm>) {
    setForm((current) => (current ? { ...current, ...next } : current));
    setError(null);
  }

  function toggleDay(day: Weekday) {
    if (!form) return;
    patch({ days: form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day] });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed || saving) return;
    if ('error' in parsed) {
      setError(t(`errors.${parsed.error}`));
      return;
    }
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api<SendRulesDto>('/v1/outreach/send-rules', {
        method: 'PUT',
        body: JSON.stringify(parsed.rules),
      });
      setLoaded(updated);
      setForm(formFromRules(updated, updated.recommended));
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

      {loaded === null || form === null ? (
        <SettingsSection title={t('timingTitle')}>
          <div role="status" aria-busy="true" className="space-y-4">
            <span className="sr-only">{tCommon('loading')}</span>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-24" />
          </div>
        </SettingsSection>
      ) : (
        <form className="space-y-10" onSubmit={(e) => void submit(e)}>
          {loaded.configured ? null : (
            <div className="flex max-w-[560px] flex-col items-start gap-3">
              <p className="flex items-start gap-2.5 text-[12.5px] leading-[1.45] text-ink dark:text-foreground">
                <span
                  aria-hidden
                  className="mt-[5px] size-[7px] shrink-0 rounded-full bg-amber-500 dark:bg-amber-400"
                />
                {t('unconfiguredNote')}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setForm(recommendedForm(loaded, browserTimeZone()))}
              >
                {t('useRecommended')}
              </Button>
            </div>
          )}

          <SettingsSection title={t('timingTitle')} help={t('timingHint')}>
            <div className="space-y-5">
              <div className="space-y-2">
                <SettingsLabel htmlFor="send-rules-timezone">{t('timezoneLabel')}</SettingsLabel>
                <NativeSelect
                  id="send-rules-timezone"
                  value={form.timezone}
                  onChange={(e) => patch({ timezone: e.target.value })}
                  disabled={saving}
                  wrapperClassName={SETTINGS_MEASURE_FIELD}
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </NativeSelect>
                <SettingsFieldNote>{t('timezoneHint')}</SettingsFieldNote>
              </div>

              <div>
                <CheckboxRow
                  checked={form.quietEnabled}
                  onChange={() => patch({ quietEnabled: !form.quietEnabled })}
                  disabled={saving}
                  title={t('quietTitle')}
                  description={t('quietHint')}
                />
                {form.quietEnabled ? (
                  <div className="flex flex-wrap items-end gap-3 pb-2 pl-[26px]">
                    <div className="space-y-1">
                      <SettingsLabel htmlFor="send-rules-quiet-from">{t('quietFrom')}</SettingsLabel>
                      <Input
                        id="send-rules-quiet-from"
                        type="time"
                        value={form.quietFrom}
                        onChange={(e) => patch({ quietFrom: e.target.value })}
                        disabled={saving}
                        className="w-[120px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <SettingsLabel htmlFor="send-rules-quiet-to">{t('quietTo')}</SettingsLabel>
                      <Input
                        id="send-rules-quiet-to"
                        type="time"
                        value={form.quietTo}
                        onChange={(e) => patch({ quietTo: e.target.value })}
                        disabled={saving}
                        className="w-[120px]"
                      />
                    </div>
                  </div>
                ) : null}
                <CheckboxRow
                  checked={form.daysEnabled}
                  onChange={() => patch({ daysEnabled: !form.daysEnabled })}
                  disabled={saving}
                  title={t('daysTitle')}
                  description={t('daysHint')}
                />
                {form.daysEnabled ? (
                  <fieldset className="flex flex-wrap gap-x-4 gap-y-2 pb-2 pl-[26px]">
                    <legend className="sr-only">{t('daysTitle')}</legend>
                    {WEEKDAYS.map((day) => (
                      <label key={day} className="flex items-center gap-1.5 text-[13px] text-ink dark:text-foreground">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-ink"
                          checked={form.days.includes(day)}
                          onChange={() => toggleDay(day)}
                          disabled={saving}
                        />
                        {t(`days.${day}`)}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title={t('frequencyTitle')} help={t('frequencyHint')}>
            <div className="space-y-5">
              <div>
                <CheckboxRow
                  checked={form.capEnabled}
                  onChange={() => patch({ capEnabled: !form.capEnabled })}
                  disabled={saving}
                  title={t('capTitle')}
                  description={t('capHint')}
                />
                {form.capEnabled ? (
                  <div className="space-y-1 pb-2 pl-[26px]">
                    <SettingsLabel htmlFor="send-rules-cap">{t('capLabel')}</SettingsLabel>
                    <Input
                      id="send-rules-cap"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={50}
                      step={1}
                      value={form.cap}
                      onChange={(e) => patch({ cap: e.target.value })}
                      disabled={saving}
                      className="w-[120px]"
                    />
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <SettingsLabel htmlFor="send-rules-cooldown">{t('cooldownLabel')}</SettingsLabel>
                <Input
                  id="send-rules-cooldown"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={720}
                  step={1}
                  value={form.cooldownHours}
                  onChange={(e) => patch({ cooldownHours: e.target.value })}
                  disabled={saving}
                  className="w-[120px]"
                />
                <SettingsFieldNote>{t('cooldownHint')}</SettingsFieldNote>
              </div>
            </div>
          </SettingsSection>

          <div className="space-y-4">
            <SettingsFieldNote>{t('scopeNote')}</SettingsFieldNote>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <SaveButton
                type="submit"
                dirty={dirty || (!!parsed && 'error' in parsed)}
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
          </div>
        </form>
      )}
    </SettingsColumn>
  );
}
