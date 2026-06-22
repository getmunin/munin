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
import { BARE_CARD } from './types';

interface OrgDto {
  id: string;
  name: string;
  slug: string;
}

interface OrgNameCardProps {
  onSaved: () => void;
  bare?: boolean;
}

export function OrgNameCard({ onSaved, bare }: OrgNameCardProps) {
  const t = useTranslations('agentSetup.org');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();

  const [name, setName] = useState('');
  const [initialName, setInitialName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const org = await api<OrgDto>('/v1/orgs/me');
      setInitialName(org.name);
      setName(org.name);
    } catch (err) {
      setError(translate(err) || t('errors.load'));
    }
  }, [t, translate]);

  useEffect(() => {
    void load();
  }, [load]);

  const trimmed = name.trim();
  const orgDirty = initialName !== null && trimmed !== initialName;
  const canContinue = trimmed.length > 0 && !saving;

  async function submit() {
    if (!canContinue) return;
    if (!orgDirty) {
      onSaved();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api<OrgDto>('/v1/orgs/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      invalidateActiveMembershipCache();
      onSaved();
    } catch (err) {
      setError(translate(err) || t('errors.save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className={bare ? BARE_CARD : undefined}>
      <CardHeader className={bare ? 'px-0' : undefined}>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('lede')}</CardDescription>
      </CardHeader>
      <CardContent className={bare ? 'space-y-5 px-0' : 'space-y-5'}>
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
