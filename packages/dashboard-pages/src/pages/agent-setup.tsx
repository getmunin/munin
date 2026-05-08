'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Hero,
  Input,
  Label,
} from '@getmunin/ui';
import { api } from '../api';
import { nativeFieldClass } from '../components/page-shell';
import { useTranslateError } from '../i18n/translate-error';

interface AgentConfigDto {
  id: string;
  enabled: boolean;
  chatModel: string;
  curatorModel: string | null;
  providerBaseUrl: string;
  providerApiKeySet: boolean;
  maxHistoryChars: number;
  maxToolIterations: number;
  debounceMs: number;
}

interface ModelEntry {
  id: string;
  contextLength: number | null;
  promptCostPerMillion: number | null;
  completionCostPerMillion: number | null;
}

interface ListModelsResult {
  supported: boolean;
  models: ModelEntry[];
}

interface UpsertBody {
  providerBaseUrl?: string;
  providerApiKey?: string | null;
  chatModel?: string;
  curatorModel?: string | null;
  enabled?: boolean;
}

const PROVIDER_PRESETS = [
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { id: 'anthropic', name: 'Anthropic', url: 'https://api.anthropic.com/v1' },
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { id: 'custom', name: 'Custom', url: '' },
] as const;

type PresetId = (typeof PROVIDER_PRESETS)[number]['id'];

function presetForUrl(url: string): PresetId {
  const match = PROVIDER_PRESETS.find((p) => p.url === url);
  return match?.id ?? 'custom';
}

export function AgentSetupPage() {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [config, setConfig] = useState<AgentConfigDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [preset, setPreset] = useState<PresetId>('openrouter');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);

  const [chatModel, setChatModel] = useState('');
  const [curatorModel, setCuratorModel] = useState('');
  const [enabled, setEnabled] = useState(false);

  const [models, setModels] = useState<ListModelsResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const cfg = await api<AgentConfigDto>('/api/agent-config');
      setConfig(cfg);
      setProviderBaseUrl(cfg.providerBaseUrl);
      setPreset(presetForUrl(cfg.providerBaseUrl));
      setChatModel(cfg.chatModel);
      setCuratorModel(cfg.curatorModel ?? '');
      setEnabled(cfg.enabled);
    } catch (err) {
      setLoadError(translate(err) || t('errors.load'));
    }
  }, [t, translate]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshModels = useCallback(async () => {
    try {
      const result = await api<ListModelsResult>('/api/agent-config/models');
      setModels(result);
    } catch (err) {
      setActionError(translate(err) || t('errors.fetchModels'));
    }
  }, [t, translate]);

  useEffect(() => {
    if (config?.providerApiKeySet) {
      void refreshModels();
    }
  }, [config?.providerApiKeySet, refreshModels]);

  function selectPreset(id: PresetId) {
    setPreset(id);
    const match = PROVIDER_PRESETS.find((p) => p.id === id);
    if (match && id !== 'custom') setProviderBaseUrl(match.url);
  }

  async function saveConnection() {
    setActionError(null);
    setActionMessage(null);
    setTesting(true);
    try {
      const body: UpsertBody = { providerBaseUrl };
      if (keyDirty && apiKey.length > 0) body.providerApiKey = apiKey;
      const updated = await api<AgentConfigDto>('/api/agent-config', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setConfig(updated);
      setApiKey('');
      setKeyDirty(false);
      const result = await api<ListModelsResult>('/api/agent-config/models');
      setModels(result);
      setActionMessage(
        result.supported
          ? t('connection.testOk', { count: result.models.length })
          : t('connection.testUnsupported'),
      );
    } catch (err) {
      setActionError(translate(err) || t('errors.test'));
    } finally {
      setTesting(false);
    }
  }

  async function saveModelsAndEnable() {
    setActionError(null);
    setActionMessage(null);
    setSaving(true);
    try {
      const updated = await api<AgentConfigDto>('/api/agent-config', {
        method: 'PUT',
        body: JSON.stringify({
          chatModel,
          curatorModel: curatorModel || null,
          enabled,
        }),
      });
      setConfig(updated);
      setActionMessage(t('saved'));
    } catch (err) {
      setActionError(translate(err) || t('errors.save'));
    } finally {
      setSaving(false);
    }
  }

  const sortedModels = useMemo(() => {
    if (!models?.supported) return [];
    return [...models.models].sort((a, b) => a.id.localeCompare(b.id));
  }, [models]);

  const canSaveModels =
    config?.providerApiKeySet === true &&
    chatModel.length > 0 &&
    !saving;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Hero title={t('title')} lede={t('lede')} />

      {loadError && (
        <Card className="mt-6">
          <CardContent className="py-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      )}

      {config === null && !loadError && (
        <p className="mt-6 text-sm text-muted-foreground">{tCommon('loading')}</p>
      )}

      {config && (
        <div className="mt-8 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('provider.title')}</CardTitle>
              <CardDescription>{t('provider.lede')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PROVIDER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPreset(p.id)}
                    className={
                      'rounded-input border px-3 py-2 text-sm transition-colors ' +
                      (preset === p.id
                        ? 'border-cobalt bg-cobalt/5 text-ink dark:text-foreground'
                        : 'border-rule-soft text-muted-foreground hover:text-ink dark:hover:text-foreground')
                    }
                  >
                    {p.name}
                  </button>
                ))}
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('apiKey.title')}</CardTitle>
              <CardDescription>
                {config.providerApiKeySet
                  ? t('apiKey.ledeStored')
                  : t('apiKey.ledeMissing')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="apiKey">{t('apiKey.label')}</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  placeholder={config.providerApiKeySet ? t('apiKey.placeholderStored') : ''}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyDirty(true);
                  }}
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void saveConnection()}
                  disabled={
                    testing ||
                    providerBaseUrl.length === 0 ||
                    (!config.providerApiKeySet && apiKey.length === 0)
                  }
                >
                  {testing ? t('connection.testing') : t('connection.test')}
                </Button>
                {actionMessage && (
                  <span className="text-sm text-muted-foreground">{actionMessage}</span>
                )}
              </div>
              {actionError && (
                <p className="text-sm text-destructive">{actionError}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('models.title')}</CardTitle>
              <CardDescription>{t('models.curatorHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!config.providerApiKeySet ? (
                <p className="text-sm text-muted-foreground">{t('models.needKey')}</p>
              ) : models?.supported ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="chatModel">{t('models.chat')}</Label>
                    <select
                      id="chatModel"
                      className={nativeFieldClass}
                      value={chatModel}
                      onChange={(e) => setChatModel(e.target.value)}
                    >
                      {sortedModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {formatModel(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="curatorModel">{t('models.curator')}</Label>
                    <select
                      id="curatorModel"
                      className={nativeFieldClass}
                      value={curatorModel}
                      onChange={(e) => setCuratorModel(e.target.value)}
                    >
                      <option value="">{t('models.curatorSameAsChat')}</option>
                      {sortedModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {formatModel(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : models && !models.supported ? (
                <>
                  <p className="text-sm text-muted-foreground">{t('models.unsupported')}</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="chatModelText">{t('models.chat')}</Label>
                    <Input
                      id="chatModelText"
                      value={chatModel}
                      onChange={(e) => setChatModel(e.target.value)}
                      placeholder="provider/model-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="curatorModelText">{t('models.curator')}</Label>
                    <Input
                      id="curatorModelText"
                      value={curatorModel}
                      onChange={(e) => setCuratorModel(e.target.value)}
                      placeholder={t('models.curatorSameAsChat')}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('enable.title')}</CardTitle>
              <CardDescription>{t('enable.lede')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span>{t('enable.checkbox')}</span>
              </label>
              <Button
                type="button"
                onClick={() => void saveModelsAndEnable()}
                disabled={!canSaveModels}
              >
                {saving ? tCommon('save') + '…' : tCommon('save')}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}

function formatModel(m: ModelEntry): string {
  const parts: string[] = [m.id];
  if (m.contextLength) parts.push(`${(m.contextLength / 1000).toFixed(0)}k ctx`);
  if (m.promptCostPerMillion !== null) {
    parts.push(`$${m.promptCostPerMillion.toFixed(2)}/M in`);
  }
  if (m.completionCostPerMillion !== null) {
    parts.push(`$${m.completionCostPerMillion.toFixed(2)}/M out`);
  }
  return parts.join(' · ');
}
