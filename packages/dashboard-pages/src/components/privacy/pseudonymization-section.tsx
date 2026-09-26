'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@getmunin/ui';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import { useLoadGate } from '../../lib/use-load-gate';
import { useRelative } from '../../lib/use-relative';
import { useConfirm } from '../confirm-dialog';
import { coverageNoticeFor, type CoverageNotice } from '../../lib/pii-coverage';
import { extractPseudonymToken } from '../../lib/pseudonym-token';
import { NativeSelect } from '../native-select';
import { Skeleton } from '../skeleton';
import {
  CheckboxRow,
  SaveButton,
  SettingsFieldNote,
  SettingsLabel,
  SettingsSection,
  SETTINGS_MEASURE_FIELD,
} from '../settings/scaffold';

type ExternalRaw = 'allow' | 'forbid';
type Layer = 'deterministic' | 'directory' | 'ner';

export interface PiiStatusDto {
  externalRaw: ExternalRaw;
  withholdUncheckedText: boolean;
  nerEnabled: boolean;
  layers: Layer[];
  coverage: { messages: number; annotated: number; lastAnnotatedAt: string | null };
}

interface TokenIdentity {
  token: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  refs: Array<{ kind: string; id: string }>;
}

const FLOORS: ExternalRaw[] = ['allow', 'forbid'];
const ALL_LAYERS: Layer[] = ['deterministic', 'directory', 'ner'];

export function PseudonymizationSection() {
  const t = useTranslations('dashboard.privacy.pseudonymization');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
  const relative = useRelative();
  const confirm = useConfirm();

  const [loaded, setLoaded] = useState<PiiStatusDto | null>(null);
  const [externalRaw, setExternalRaw] = useState<ExternalRaw>('allow');
  const [withhold, setWithhold] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const data = await api<PiiStatusDto>('/v1/pii');
    setLoaded(data);
    setExternalRaw(data.externalRaw);
    setWithhold(data.withholdUncheckedText);
  }, []);
  const { loadError, tryLoad } = useLoadGate(load);

  useEffect(() => {
    void tryLoad();
  }, [tryLoad]);

  const dirty =
    !!loaded &&
    (externalRaw !== loaded.externalRaw || withhold !== loaded.withholdUncheckedText);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving || !loaded) return;
    if (withhold && !loaded.withholdUncheckedText) {
      const ok = await confirm({
        title: t('withholdConfirm.title'),
        message: loaded.nerEnabled ? t('withholdConfirm.body') : t('withholdConfirm.bodyNoNer'),
        confirmLabel: t('withholdConfirm.confirm'),
        cancelLabel: tCommon('cancel'),
        destructive: !loaded.nerEnabled,
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api<PiiStatusDto>('/v1/pii', {
        method: 'PUT',
        body: JSON.stringify({ externalRaw, withholdUncheckedText: withhold }),
      });
      setLoaded(updated);
      setExternalRaw(updated.externalRaw);
      setWithhold(updated.withholdUncheckedText);
      setSavedAt(Date.now());
    } catch (err) {
      setError(translate(err) || t('errors.save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title={t('sectionTitle')}
      meta={loaded ? t(`sectionMeta.${loaded.externalRaw}`) : undefined}
      help={t('help')}
    >
      {loaded === null ? (
        loadError ? (
          <p className="text-sm text-destructive" role="alert">
            {t('errors.load')}
          </p>
        ) : (
          <div role="status" aria-busy="true" className="space-y-4">
            <span className="sr-only">{tCommon('loading')}</span>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        )
      ) : (
        <div className="space-y-6">
          <CoverageCallout notice={coverageNoticeFor(loaded)} status={loaded} />

          <form className="space-y-4" onSubmit={(e) => void submit(e)}>
            <div className="space-y-2">
              <SettingsLabel htmlFor="pii-floor">{t('floorLabel')}</SettingsLabel>
              <NativeSelect
                id="pii-floor"
                value={externalRaw}
                onChange={(e) => setExternalRaw(e.target.value as ExternalRaw)}
                disabled={saving}
                wrapperClassName={SETTINGS_MEASURE_FIELD}
              >
                {FLOORS.map((option) => (
                  <option key={option} value={option}>
                    {t(`floors.${option}`)}
                  </option>
                ))}
              </NativeSelect>
              <SettingsFieldNote>{t(`floorHint.${externalRaw}`)}</SettingsFieldNote>
            </div>

            <div className="max-w-[460px]">
              <CheckboxRow
                checked={withhold}
                onChange={() => setWithhold((current) => !current)}
                disabled={saving}
                title={t('withholdLabel')}
                description={t('withholdHint')}
              />
            </div>

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
              {savedAt && !dirty && !error ? (
                <span key={savedAt} className="text-sm text-ink-mute">
                  {tCommon('saved')}
                </span>
              ) : null}
            </div>
          </form>

          <div className="space-y-2">
            <p className="block text-[12.5px] font-semibold text-ink dark:text-foreground">
              {t('layersLabel')}
            </p>
            <ul className="max-w-[460px]">
              {ALL_LAYERS.map((layer) => {
                const active = loaded.layers.includes(layer);
                return (
                  <li
                    key={layer}
                    className="flex items-start justify-between gap-4 border-b-[1px] border-rule-soft py-2.5 last:border-0 dark:border-rule-on-dark"
                  >
                    <span className="flex flex-col gap-1">
                      <span className="text-[13.5px] text-ink dark:text-foreground">
                        {t(`layers.${layer}`)}
                      </span>
                      {layer === 'ner' ? (
                        <span className="text-[11.5px] leading-[1.4] text-ink-mute">
                          {active
                            ? [
                                t('nerCoverage', {
                                  annotated: loaded.coverage.annotated,
                                  messages: loaded.coverage.messages,
                                }),
                                loaded.coverage.lastAnnotatedAt
                                  ? t('nerLastRun', { when: relative(loaded.coverage.lastAnnotatedAt) })
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : t('nerOff')}
                        </span>
                      ) : null}
                    </span>
                    <span className="whitespace-nowrap font-mono text-[10px] font-medium uppercase tracking-eyebrow text-ink-mute">
                      {active ? t('layerOn') : t('layerOff')}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <TokenLookup />
        </div>
      )}
    </SettingsSection>
  );
}

function CoverageCallout({ notice, status }: { notice: CoverageNotice | null; status: PiiStatusDto }) {
  const t = useTranslations('dashboard.privacy.pseudonymization.notice');
  if (!notice) return null;
  const remaining = Math.max(status.coverage.messages - status.coverage.annotated, 0);
  const values = {
    annotated: status.coverage.annotated,
    messages: status.coverage.messages,
    remaining,
  };
  return (
    <div
      role="note"
      data-coverage-notice={notice}
      className="max-w-[520px] border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-[12.5px] leading-[1.5] text-ink dark:bg-amber-950/30 dark:text-foreground"
    >
      <p>{t(notice, values)}</p>
      {notice === 'pending' || notice === 'noNer' ? (
        <p className="mt-1 text-ink-mute">{t(`${notice}Hint`)}</p>
      ) : null}
    </div>
  );
}

function TokenLookup() {
  const t = useTranslations('dashboard.privacy.pseudonymization');
  const translate = useTranslateError();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TokenIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token = extractPseudonymToken(input);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api<TokenIdentity>(`/v1/pii/tokens/${token}`));
    } catch (err) {
      setError(translate(err) || t('errors.lookup'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-2" onSubmit={(e) => void lookup(e)}>
      <SettingsLabel htmlFor="pii-token">{t('lookupLabel')}</SettingsLabel>
      <div className={`flex items-center gap-2 ${SETTINGS_MEASURE_FIELD}`}>
        <Input
          id="pii-token"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('lookupPlaceholder')}
          autoComplete="off"
          spellCheck={false}
        />
        <SaveButton
          type="submit"
          dirty={!!token}
          saving={busy}
          label={t('lookupSubmit')}
          savingLabel={t('lookupSubmit')}
        />
      </div>
      <SettingsFieldNote>{t('lookupHint')}</SettingsFieldNote>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <dl className="max-w-[460px] border-l-2 border-ink px-3 py-2 text-[13px] dark:border-paper">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-mute">{t('lookupName')}</dt>
            <dd className="text-ink dark:text-foreground">{result.name ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-mute">{t('lookupEmail')}</dt>
            <dd className="text-ink dark:text-foreground [overflow-wrap:anywhere]">{result.email ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-mute">{t('lookupPhone')}</dt>
            <dd className="text-ink dark:text-foreground">{result.phone ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-mute">{t('lookupRecords')}</dt>
            <dd className="font-mono text-[11.5px] text-ink-mute [overflow-wrap:anywhere]">
              {result.refs.map((r) => r.id).join(', ')}
            </dd>
          </div>
        </dl>
      ) : null}
    </form>
  );
}
