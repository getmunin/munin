'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { invalidateActiveMembershipCache } from '../../auth/use-active-role';
import { useTranslateError } from '../../i18n/translate-error';

interface OrgDto {
  id: string;
  name: string;
  slug: string;
}

interface AssistantDto {
  id: string;
  orgId: string;
  name: string | null;
  greeting: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrgNameCardProps {
  onSaved: () => void;
}

export function OrgNameCard({ onSaved }: OrgNameCardProps) {
  const t = useTranslations('agentSetup.org');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [name, setName] = useState('');
  const [initialName, setInitialName] = useState<string | null>(null);
  const [chatbotName, setChatbotName] = useState('');
  const [initialChatbotName, setInitialChatbotName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [org, assistant] = await Promise.all([
        api<OrgDto>('/api/v1/orgs/me'),
        api<AssistantDto>('/api/v1/assistants/me').catch(() => null),
      ]);
      setInitialName(org.name);
      setName(org.name);
      const existingChatbot = assistant?.name ?? '';
      setInitialChatbotName(existingChatbot);
      setChatbotName(existingChatbot);
    } catch (err) {
      setError(translate(err) || t('errors.load'));
    }
  }, [t, translate]);

  useEffect(() => {
    void load();
  }, [load]);

  const trimmed = name.trim();
  const trimmedChatbot = chatbotName.trim();
  const orgDirty = initialName !== null && trimmed !== initialName;
  const chatbotDirty =
    initialChatbotName !== null && trimmedChatbot !== initialChatbotName;
  const canContinue = trimmed.length > 0 && !saving;

  async function submit() {
    if (!canContinue) return;
    if (!orgDirty && !chatbotDirty) {
      onSaved();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (orgDirty) {
        await api<OrgDto>('/api/v1/orgs/me', {
          method: 'PATCH',
          body: JSON.stringify({ name: trimmed }),
        });
        invalidateActiveMembershipCache();
      }
      if (chatbotDirty) {
        await api<AssistantDto>('/api/v1/assistants/me', {
          method: 'PATCH',
          body: JSON.stringify({ name: trimmedChatbot === '' ? null : trimmedChatbot }),
        });
      }
      onSaved();
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
        <CardDescription>{t('lede')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="orgName">{t('nameLabel')}</Label>
          <Input
            id="orgName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            maxLength={128}
            disabled={initialName === null}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">{t('nameHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="chatbotName">{t('chatbotNameLabel')}</Label>
          <Input
            id="chatbotName"
            value={chatbotName}
            onChange={(e) => setChatbotName(e.target.value)}
            placeholder={t('chatbotNamePlaceholder')}
            maxLength={64}
            disabled={initialChatbotName === null}
          />
          <p className="text-xs text-muted-foreground">{t('chatbotNameHint')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void submit()} disabled={!canContinue}>
            {saving ? tCommon('saving') : t('continue')}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
