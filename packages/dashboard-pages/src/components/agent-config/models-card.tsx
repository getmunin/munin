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
import { nativeFieldClass } from '../page-shell';
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

  const [chatModel, setChatModel] = useState(config.chatModel);
  const [curatorModel, setCuratorModel] = useState(config.curatorModel ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedModels = useMemo(() => {
    if (!models?.supported) return [];
    return [...models.models].sort((a, b) => a.id.localeCompare(b.id));
  }, [models]);

  async function save() {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const updated = await api<AgentConfigDto>('/api/v1/agent-config', {
        method: 'PUT',
        body: JSON.stringify({
          chatModel,
          curatorModel: curatorModel || null,
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

  const canSave = config.providerApiKeySet && chatModel.length > 0 && !saving;
  const label = saveLabel ?? tCommon('save');

  return (
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
