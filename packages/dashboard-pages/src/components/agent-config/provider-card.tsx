'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@getmunin/ui';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import {
  PickerRow,
  SaveButton,
  SettingsLabel,
  SETTINGS_MEASURE_FIELD,
} from '../settings/scaffold';
import {
  BARE_CARD,
  PROVIDER_PRESETS,
  presetForUrl,
  type AgentConfigDto,
  type ListModelsResult,
  type ProviderPreset,
  type UpsertBody,
} from './types';

const BUILTIN_PRESET_IDS = new Set<string>(PROVIDER_PRESETS.map((p) => p.id));

interface ProviderCardProps {
  config: AgentConfigDto;
  extraPresets?: ProviderPreset[];
  defaultPresetId?: string;
  lede?: string;
  bare?: boolean;
  headless?: boolean;
  saveLabel?: string;
  onBack?: () => void;
  onSaved?: (updated: AgentConfigDto, models: ListModelsResult) => void;
}

export function ProviderCard({
  config,
  extraPresets,
  defaultPresetId,
  lede,
  bare,
  headless,
  saveLabel,
  onBack,
  onSaved,
}: ProviderCardProps) {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const managedPreset = (extraPresets ?? []).find((p) => p.managed);
  const byokPresets: ProviderPreset[] = [
    ...(extraPresets ?? []).filter((p) => !p.managed),
    ...PROVIDER_PRESETS,
  ];
  const allPresets = managedPreset ? [managedPreset, ...byokPresets] : byokPresets;

  const initialPreset =
    !config.providerApiKeySet && defaultPresetId
      ? defaultPresetId
      : presetForUrl(config.providerBaseUrl);

  const [preset, setPreset] = useState<string>(initialPreset);
  const [providerBaseUrl, setProviderBaseUrl] = useState(config.providerBaseUrl);
  const [apiKey, setApiKey] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showByok, setShowByok] = useState<boolean>(
    !(allPresets.find((p) => p.id === initialPreset)?.managed ?? false),
  );

  const selected = allPresets.find((p) => p.id === preset);
  const isManaged = selected?.managed ?? false;

  function selectPreset(id: string) {
    setPreset(id);
    const match = allPresets.find((p) => p.id === id);
    if (match && !match.managed && id !== 'custom') setProviderBaseUrl(match.url);
  }

  async function saveManaged() {
    setError(null);
    setMessage(null);
    setTesting(true);
    try {
      const updated = await api<AgentConfigDto>('/v1/agent-config', {
        method: 'PUT',
        body: JSON.stringify({ providerApiKey: null } satisfies UpsertBody),
      });
      setApiKey('');
      setKeyDirty(false);
      const managedModels = managedPreset?.models ?? [];
      setMessage(tCommon('saved'));
      onSaved?.(
        updated,
        managedModels.length > 0
          ? { supported: true, models: managedModels }
          : await api<ListModelsResult>('/v1/agent-config/models'),
      );
    } catch (err) {
      setError(translate(err) || t('errors.test'));
    } finally {
      setTesting(false);
    }
  }

  async function saveAndTest() {
    setError(null);
    setMessage(null);
    setTesting(true);
    try {
      const body: UpsertBody = { providerBaseUrl };
      if (keyDirty && apiKey.length > 0) body.providerApiKey = apiKey;
      const updated = await api<AgentConfigDto>('/v1/agent-config', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setApiKey('');
      setKeyDirty(false);
      const result = await api<ListModelsResult>('/v1/agent-config/models');
      setMessage(
        result.supported
          ? t('connection.testOk', { count: result.models.length })
          : t('connection.testUnsupported'),
      );
      onSaved?.(updated, result);
    } catch (err) {
      setError(translate(err) || t('errors.test'));
    } finally {
      setTesting(false);
    }
  }

  const saveDisabled =
    testing || providerBaseUrl.length === 0 || (!config.providerApiKeySet && apiKey.length === 0);

  function presetDescription(p: ProviderPreset): ReactNode {
    if (p.description != null) return p.description;
    if (BUILTIN_PRESET_IDS.has(p.id)) return t(`provider.presets.${p.id}`);
    return null;
  }

  function presetGrid(items: ProviderPreset[]) {
    return (
      <div className="space-y-2">
        {items.map((p) => (
          <PickerRow
            key={p.id}
            title={p.name}
            description={presetDescription(p)}
            selected={preset === p.id}
            value={preset === p.id ? t('provider.inUse') : undefined}
            onClick={() => selectPreset(p.id)}
          />
        ))}
      </div>
    );
  }

  const credentialInputs = (
    <>
      <div className="space-y-1.5">
        <SettingsLabel htmlFor="providerBaseUrl">{t('provider.urlLabel')}</SettingsLabel>
        <Input
          id="providerBaseUrl"
          className={SETTINGS_MEASURE_FIELD}
          value={providerBaseUrl}
          onChange={(e) => {
            setProviderBaseUrl(e.target.value);
            setPreset('custom');
          }}
          placeholder="https://..."
        />
      </div>
      <div className="space-y-1.5 pt-2">
        <SettingsLabel htmlFor="apiKey">{t('apiKey.label')}</SettingsLabel>
        <Input
          id="apiKey"
          className={SETTINGS_MEASURE_FIELD}
          type="password"
          value={apiKey}
          placeholder={
            config.providerApiKeySet ? t('apiKey.placeholderStored') : t('apiKey.ledeMissing')
          }
          onChange={(e) => {
            setApiKey(e.target.value);
            setKeyDirty(true);
          }}
        />
      </div>
    </>
  );

  function submitRow(onClick: () => void, disabled: boolean) {
    return (
      <div className="flex items-center gap-3">
        <SaveButton
          dirty={!disabled}
          saving={testing}
          onClick={onClick}
          label={saveLabel ?? tCommon('save')}
          savingLabel={t('connection.testing')}
        />
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack}>
            {tCommon('back')}
          </Button>
        )}
        {message && <span className="text-sm text-ink-mute">{message}</span>}
      </div>
    );
  }

  const body = (
    <div className="space-y-4">
      {managedPreset ? (
        <>
          <div className="space-y-2">
            <PickerRow
              title={managedPreset.name}
              description={managedPreset.description}
              selected={preset === managedPreset.id}
              value={preset === managedPreset.id ? t('provider.inUse') : undefined}
              onClick={() => {
                selectPreset(managedPreset.id);
                setShowByok(false);
              }}
            />
            <PickerRow
              title={t('provider.useOwnKey')}
              description={t('provider.ownKeyBlurb')}
              selected={showByok}
              value={showByok ? t('provider.inUse') : t('provider.configure')}
              onClick={() => setShowByok(true)}
            />
          </div>

          {showByok && (
            <div className="space-y-4">
              {presetGrid(byokPresets)}
              {!isManaged && credentialInputs}
            </div>
          )}

          {submitRow(
            isManaged && !showByok ? () => void saveManaged() : () => void saveAndTest(),
            isManaged && !showByok ? testing : saveDisabled,
          )}
        </>
      ) : (
        <>
          {presetGrid(byokPresets)}
          {credentialInputs}
          {submitRow(() => void saveAndTest(), saveDisabled)}
        </>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );

  if (headless) return body;

  return (
    <Card className={bare ? BARE_CARD : undefined}>
      <CardHeader className={bare ? 'px-0' : undefined}>
        <CardTitle>{t('provider.title')}</CardTitle>
        <CardDescription>{lede ?? t('provider.lede')}</CardDescription>
      </CardHeader>
      <CardContent className={bare ? 'px-0' : undefined}>{body}</CardContent>
    </Card>
  );
}
