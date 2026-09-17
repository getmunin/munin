'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@getmunin/ui';
import { api } from '../../api';
import { SaveButton, SettingsLabel, SETTINGS_MEASURE_FIELD } from '../settings/scaffold';
import { NativeSelect } from '../native-select';
import { useTranslateError } from '../../i18n/translate-error';
import {
  formatModel,
  modelSortKey,
  BARE_CARD,
  type AgentConfigDto,
  type ListModelsResult,
} from './types';

interface ModelsCardProps {
  config: AgentConfigDto;
  models: ListModelsResult | null;
  managed?: boolean;
  saveLabel?: string;
  extraActions?: ReactNode;
  bare?: boolean;
  headless?: boolean;
  onSaved?: (updated: AgentConfigDto) => void;
}

export function ModelsCard({
  config,
  models,
  managed,
  saveLabel,
  extraActions,
  bare,
  headless,
  onSaved,
}: ModelsCardProps) {
  const t = useTranslations('agentSetup');
  const modalityLabels = {
    chat: t('models.capabilityChat'),
    vision: t('models.capabilityVision'),
  };
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [fastModel, setFastModel] = useState(config.fastModel);
  const [smartModel, setSmartModel] = useState(config.smartModel ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedModels = useMemo(() => {
    if (!models?.supported) return [];
    return [...models.models].sort((a, b) => modelSortKey(a).localeCompare(modelSortKey(b)));
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

  const credentialed = config.providerApiKeySet || managed === true;
  const canSave = credentialed && fastModel.length > 0 && !saving;
  const label = saveLabel ?? tCommon('save');

  const body = <div className="space-y-4">
        {!credentialed ? (
          <p className="text-sm text-muted-foreground">{t('models.needKey')}</p>
        ) : models?.supported ? (
          <>
            <div className="space-y-1.5">
              <SettingsLabel htmlFor="fastModel">{t('models.fast')}</SettingsLabel>
              <p className="text-xs text-muted-foreground">{t('models.fastHint')}</p>
              <NativeSelect
                id="fastModel"
                wrapperClassName={SETTINGS_MEASURE_FIELD}
                value={effectiveFast}
                onChange={(e) => setFastModel(e.target.value)}
              >
                {sortedModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatModel(m, modalityLabels)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <SettingsLabel htmlFor="smartModel">{t('models.smart')}</SettingsLabel>
              <p className="text-xs text-muted-foreground">{t('models.smartUseHint')}</p>
              <NativeSelect
                id="smartModel"
                wrapperClassName={SETTINGS_MEASURE_FIELD}
                value={effectiveSmart}
                onChange={(e) => setSmartModel(e.target.value)}
              >
                <option value="">{t('models.smartSameAsFast')}</option>
                {sortedModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatModel(m, modalityLabels)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </>
        ) : models && !models.supported ? (
          <>
            <p className="text-sm text-muted-foreground">{t('models.unsupported')}</p>
            <div className="space-y-1.5">
              <SettingsLabel htmlFor="fastModelText">{t('models.fast')}</SettingsLabel>
              <p className="text-xs text-muted-foreground">{t('models.fastHint')}</p>
              <Input
                id="fastModelText"
                className={SETTINGS_MEASURE_FIELD}
                value={fastModel}
                onChange={(e) => setFastModel(e.target.value)}
                placeholder="provider/model-name"
              />
            </div>
            <div className="space-y-1.5">
              <SettingsLabel htmlFor="smartModelText">{t('models.smart')}</SettingsLabel>
              <p className="text-xs text-muted-foreground">{t('models.smartUseHint')}</p>
              <Input
                id="smartModelText"
                className={SETTINGS_MEASURE_FIELD}
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
          <SaveButton
            dirty={canSave || saving}
            saving={saving}
            onClick={() => void save()}
            label={label}
            savingLabel={label + '…'}
          />
          {extraActions}
          {message && <span className="text-sm text-muted-foreground">{message}</span>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>;

  if (headless) return body;

  return (
    <Card className={bare ? BARE_CARD : undefined}>
      <CardHeader className={bare ? 'px-0' : undefined}>
        <CardTitle>{t('models.title')}</CardTitle>
        <CardDescription>{t('models.smartHint')}</CardDescription>
      </CardHeader>
      <CardContent className={bare ? 'px-0' : undefined}>{body}</CardContent>
    </Card>
  );
}
