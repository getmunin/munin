'use client';

import { useState, type ComponentType, type SVGProps } from 'react';
import { useTranslations } from 'next-intl';
import { Plug } from 'lucide-react';
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
  type PresetId,
  type UpsertBody,
} from './types';

const PROVIDER_ICONS: Record<PresetId, ComponentType<SVGProps<SVGSVGElement>>> = {
  openrouter: OpenRouterIcon,
  anthropic: AnthropicIcon,
  openai: OpenAiIcon,
  custom: Plug,
};

interface ProviderCardProps {
  config: AgentConfigDto;
  onSaved?: (updated: AgentConfigDto, models: ListModelsResult) => void;
}

export function ProviderCard({ config, onSaved }: ProviderCardProps) {
  const t = useTranslations('agentSetup');
  const translate = useTranslateError();

  const [preset, setPreset] = useState<PresetId>(presetForUrl(config.providerBaseUrl));
  const [providerBaseUrl, setProviderBaseUrl] = useState(config.providerBaseUrl);
  const [apiKey, setApiKey] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectPreset(id: PresetId) {
    setPreset(id);
    const match = PROVIDER_PRESETS.find((p) => p.id === id);
    if (match && id !== 'custom') setProviderBaseUrl(match.url);
  }

  async function saveAndTest() {
    setError(null);
    setMessage(null);
    setTesting(true);
    try {
      const body: UpsertBody = { providerBaseUrl };
      if (keyDirty && apiKey.length > 0) body.providerApiKey = apiKey;
      let updated = await api<AgentConfigDto>('/api/v1/agent-config', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setApiKey('');
      setKeyDirty(false);
      const result = await api<ListModelsResult>('/api/v1/agent-config/models');
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('provider.title')}</CardTitle>
        <CardDescription>{t('provider.lede')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PROVIDER_PRESETS.map((p) => {
            const Icon = PROVIDER_ICONS[p.id];
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPreset(p.id)}
                className={
                  'flex items-center justify-center gap-2 rounded-input border-[0.5px] px-3 py-2 text-sm transition-colors ' +
                  (preset === p.id
                    ? 'border-cobalt bg-cobalt/5 text-ink dark:text-foreground'
                    : 'border-rule-soft text-muted-foreground hover:text-ink dark:hover:text-foreground')
                }
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>
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
        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void saveAndTest()} disabled={saveDisabled}>
            {testing ? t('connection.testing') : t('connection.test')}
          </Button>
          {message && <span className="text-sm text-muted-foreground">{message}</span>}
        </div>
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
  return api<AgentConfigDto>('/api/v1/agent-config', {
    method: 'PUT',
    body: JSON.stringify({
      fastModel: fastInvalid ? models.models[0]!.id : config.fastModel,
      smartModel: smartInvalid ? null : config.smartModel,
    } satisfies UpsertBody),
  });
}
