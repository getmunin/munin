'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@getmunin/ui';
import {
  SaveButton,
  SettingsFieldNote,
  SettingsLabel,
  SETTINGS_MEASURE_FIELD,
} from '../settings/scaffold';
import { api } from '../../api';
import { useTranslateError } from '../../i18n/translate-error';
import type { AssistantDto, UpdateAssistantBody } from './types';

interface IdentityCardProps {
  assistant: AssistantDto;
  headless?: boolean;
  onSaved: (updated: AssistantDto) => void;
}

export function IdentityCard({ assistant, headless, onSaved }: IdentityCardProps) {
  const t = useTranslations('assistants.identity');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [name, setName] = useState(assistant.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const trimmed = name.trim();
  const initial = (assistant.name ?? '').trim();
  const dirty = trimmed !== initial;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: UpdateAssistantBody = { name: trimmed === '' ? null : trimmed };
      const updated = await api<AssistantDto>('/v1/assistants/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSaved(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError(translate(err) || t('errors.save'));
    } finally {
      setSaving(false);
    }
  }

  const body = (
    <div className="space-y-5">
      <div className="space-y-2">
        <SettingsLabel htmlFor="assistant-name">{t('nameLabel')}</SettingsLabel>
        <Input
          id="assistant-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
          maxLength={64}
          disabled={saving}
          className={SETTINGS_MEASURE_FIELD}
        />
        <SettingsFieldNote>{t('nameHelp')}</SettingsFieldNote>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <SaveButton
          dirty={dirty}
          saving={saving}
          onClick={() => void save()}
          label={tCommon('save')}
          savingLabel={tCommon('saving')}
        />
        {!error && savedAt !== null && !dirty && (
          <span className="text-sm text-ink-mute">{tCommon('saved')}</span>
        )}
      </div>
    </div>
  );

  if (headless) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('blurb')}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
