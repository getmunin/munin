'use client';

import { useState } from 'react';
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
import { useTranslateError } from '../../i18n/translate-error';
import type { AssistantDto, UpdateAssistantBody } from './types';

interface IdentityCardProps {
  assistant: AssistantDto;
  onSaved: (updated: AssistantDto) => void;
}

export function IdentityCard({ assistant, onSaved }: IdentityCardProps) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('blurb')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="assistant-name">{t('nameLabel')}</Label>
          <Input
            id="assistant-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            maxLength={64}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">{t('nameHelp')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? tCommon('saving') : tCommon('save')}
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
          {!error && savedAt !== null && !dirty && (
            <span className="text-sm text-muted-foreground">{tCommon('saved')}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
