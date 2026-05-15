'use client';

import { useTranslations } from 'next-intl';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';

export function ChatAssistantCard() {
  const t = useTranslations('assistants.list.chatAssistant');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription className="mt-1">{t('description')}</CardDescription>
          </div>
          <span className="font-mono text-xs uppercase tracking-eyebrow text-muted-foreground">
            {t('tierLabel', { tier: 'fast' })}
          </span>
        </div>
      </CardHeader>
    </Card>
  );
}
