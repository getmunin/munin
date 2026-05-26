'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
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
import { NativeSelect } from '../native-select';
import { useTranslateError } from '../../i18n/translate-error';
import {
  formatModel,
  type AgentConfigDto,
  type ListModelsResult,
} from './types';

interface ModelsCardProps {
  config: AgentConfigDto;
  models: ListModelsResult | null;
  saveLabel?: string;
  /** Extra action rendered after the Save button (e.g., wizard's Back). */
  extraActions?: ReactNode;
  onSaved?: (updated: AgentConfigDto) => void;
}

export function ModelsCard({ config, models, saveLabel, extraActions, onSaved }: ModelsCardProps) {
  const t = useTranslations('agentSetup');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [fastModel, setFastModel] = useState(config.fastModel);
  const [smartModel, setSmartModel] = useState(config.smartModel ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedModels = useMemo(() => {
    if (!models?.supported) return [];
    return [...models.models].sort((a, b) => a.id.localeCompare(b.id));
  }, [models]);

  const knownIds = useMemo(() => new Set(sortedModels.map((m) => m.id)), [sortedModels]);
  const effectiveFast = knownIds.has(fastModel) ? fastModel : sortedModels[0]?.id ?? fastModel;
  const effectiveSmart = !smartModel || knownIds.has(smartModel) ? smartModel : '';

  async function save() {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const updated = await api<AgentConfigDto>('/v1/agent-config', {
        method: 'PUT',
        body: JSON.stringify({
          fastModel: effectiveFast,
          smartModel: effectiveSmart || null,
        }),
      });
      setMessage(t('saved'));
      onSaved?.(updated);
    } catch (err) {
      setError(translate(err) || t('errors.save'));
    } finally {
      setSaving(false);
    }
  }

  const canSave = config.providerApiKeySet && fastModel.length > 0 && !saving;
  const label = saveLabel ?? tCommon('save');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('models.title')}</CardTitle>
        <CardDescription>{t('models.smartHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!config.providerApiKeySet ? (
          <p className="text-sm text-muted-foreground">{t('models.needKey')}</p>
        ) : models?.supported ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="fastModel">{t('models.fast')}</Label>
              <p className="text-xs text-muted-foreground">{t('models.fastHint')}</p>
              <NativeSelect
                id="fastModel"
                value={effectiveFast}
                onChange={(e) => setFastModel(e.target.value)}
              >
                {sortedModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatModel(m)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smartModel">{t('models.smart')}</Label>
              <p className="text-xs text-muted-foreground">{t('models.smartUseHint')}</p>
              <NativeSelect
                id="smartModel"
                value={effectiveSmart}
                onChange={(e) => setSmartModel(e.target.value)}
              >
                <option value="">{t('models.smartSameAsFast')}</option>
                {sortedModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatModel(m)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </>
        ) : models && !models.supported ? (
          <>
            <p className="text-sm text-muted-foreground">{t('models.unsupported')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="fastModelText">{t('models.fast')}</Label>
              <p className="text-xs text-muted-foreground">{t('models.fastHint')}</p>
              <Input
                id="fastModelText"
                value={fastModel}
                onChange={(e) => setFastModel(e.target.value)}
                placeholder="provider/model-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smartModelText">{t('models.smart')}</Label>
              <p className="text-xs text-muted-foreground">{t('models.smartUseHint')}</p>
              <Input
                id="smartModelText"
                value={smartModel}
                onChange={(e) => setSmartModel(e.target.value)}
                placeholder={t('models.smartSameAsFast')}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        )}
        <div className="flex items-center gap-3">
          {extraActions}
          <Button type="button" onClick={() => void save()} disabled={!canSave}>
            {saving ? label + '…' : label}
          </Button>
          {message && <span className="text-sm text-muted-foreground">{message}</span>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
