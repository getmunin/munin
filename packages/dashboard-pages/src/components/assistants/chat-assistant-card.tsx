'use client';

import { useTranslations } from 'next-intl';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';
import { Link } from '../../i18n-navigation';
import type { AssistantDto } from './types';

interface ChatAssistantCardProps {
  assistant: AssistantDto | null;
}

export function ChatAssistantCard({ assistant }: ChatAssistantCardProps) {
  const t = useTranslations('assistants.list.chatAssistant');
  const name = assistant?.name?.trim() ?? '';
  const displayName = name === '' ? t('unnamed') : name;

  return (
    <Link
      href="/dashboard/settings/assistants/chat"
      className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="transition-colors hover:bg-muted/30">
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
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t('nameLabel')}: <span className="text-foreground">{displayName}</span>
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
