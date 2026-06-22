'use client';

import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, ChevronRight, Plug, Sparkles } from 'lucide-react';
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
import { AnthropicIcon, OpenAiIcon, OpenRouterIcon } from './provider-icons';
import {
  PROVIDER_PRESETS,
  presetForUrl,
  type AgentConfigDto,
  type ListModelsResult,
  type ProviderPreset,
  type UpsertBody,
} from './types';

const PROVIDER_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  openrouter: OpenRouterIcon,
  anthropic: AnthropicIcon,
  openai: OpenAiIcon,
  custom: Plug,
};

const BUILTIN_PRESET_IDS = new Set<string>(PROVIDER_PRESETS.map((p) => p.id));

interface ProviderCardProps {
  config: AgentConfigDto;
  extraPresets?: ProviderPreset[];
  defaultPresetId?: string;
  lede?: string;
  onSaved?: (updated: AgentConfigDto, models: ListModelsResult) => void;
}

export function ProviderCard({
  config,
  extraPresets,
  defaultPresetId,
  lede,
  onSaved,
}: ProviderCardProps) {
  const t = useTranslations('agentSetup');
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
      onSaved?.(updated, { supported: false, models: [] });
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
      let updated = await api<AgentConfigDto>('/v1/agent-config', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setApiKey('');
      setKeyDirty(false);
      const result = await api<ListModelsResult>('/v1/agent-config/models');
      updated = await reconcileModelsAgainstProvider(updated, result);
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((p) => {
          const Icon = PROVIDER_ICONS[p.id] ?? Plug;
          const description = presetDescription(p);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPreset(p.id)}
              className={
                'flex items-center gap-3 rounded-input border-[0.5px] px-4 py-3 text-left transition-colors ' +
                (preset === p.id
                  ? 'border-cobalt bg-cobalt/5 ring-1 ring-inset ring-cobalt'
                  : 'border-rule-soft hover:border-ink/30')
              }
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block font-semibold text-ink dark:text-foreground">{p.name}</span>
                {description && (
                  <span className="block text-sm text-muted-foreground">{description}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  const credentialInputs = (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="providerBaseUrl">{t('provider.urlLabel')}</Label>
        <Input
          id="providerBaseUrl"
          value={providerBaseUrl}
          onChange={(e) => {
            setProviderBaseUrl(e.target.value);
            setPreset('custom');
          }}
          placeholder="https://..."
        />
      </div>
      <div className="space-y-1.5 pt-2">
        <Label htmlFor="apiKey">{t('apiKey.label')}</Label>
        <Input
          id="apiKey"
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
        <Button type="button" onClick={onClick} disabled={disabled}>
          {testing ? t('connection.testing') : t('provider.use')}
        </Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('provider.title')}</CardTitle>
        <CardDescription>{lede ?? t('provider.lede')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {managedPreset ? (
          <>
            <button
              type="button"
              onClick={() => selectPreset(managedPreset.id)}
              className={
                'flex w-full items-center gap-4 rounded-input border-[0.5px] px-4 py-3.5 text-left transition-colors ' +
                (preset === managedPreset.id
                  ? 'border-cobalt bg-cobalt/5 ring-1 ring-inset ring-cobalt'
                  : 'border-rule-soft hover:border-ink/30')
              }
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-input bg-cobalt/10 text-cobalt">
                {managedPreset.icon ?? <Sparkles className="size-5" aria-hidden />}
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-ink dark:text-foreground">
                    {managedPreset.name}
                  </span>
                  {managedPreset.badge && (
                    <span className="rounded bg-cobalt/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-cobalt">
                      {managedPreset.badge}
                    </span>
                  )}
                </span>
                {managedPreset.description && (
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {managedPreset.description}
                  </span>
                )}
              </span>
              {preset === managedPreset.id && (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cobalt text-white">
                  <Check className="size-3.5" aria-hidden />
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowByok((v) => !v)}
              className="flex w-full items-center justify-center gap-2 rounded-input border border-dashed border-rule-soft px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-ink dark:hover:text-foreground"
            >
              {showByok ? (
                <ChevronDown className="size-4 shrink-0" aria-hidden />
              ) : (
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              )}
              <span>{showByok ? t('provider.hideAlternatives') : t('provider.useOwnKey')}</span>
            </button>

            {showByok && (
              <>
                {presetGrid(byokPresets)}
                {!isManaged && credentialInputs}
              </>
            )}

            {submitRow(
              isManaged ? () => void saveManaged() : () => void saveAndTest(),
              isManaged ? testing : saveDisabled,
            )}
          </>
        ) : (
          <>
            {presetGrid(byokPresets)}
            {credentialInputs}
            {submitRow(() => void saveAndTest(), saveDisabled)}
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

async function reconcileModelsAgainstProvider(
  config: AgentConfigDto,
  models: ListModelsResult,
): Promise<AgentConfigDto> {
  if (!models.supported || models.models.length === 0) return config;
  const known = new Set(models.models.map((m) => m.id));
  const fastInvalid = !known.has(config.fastModel);
  const smartInvalid = config.smartModel != null && !known.has(config.smartModel);
  if (!fastInvalid && !smartInvalid) return config;
  return api<AgentConfigDto>('/v1/agent-config', {
    method: 'PUT',
    body: JSON.stringify({
      fastModel: fastInvalid ? models.models[0]!.id : config.fastModel,
      smartModel: smartInvalid ? null : config.smartModel,
    } satisfies UpsertBody),
  });
}
