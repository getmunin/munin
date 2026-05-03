import Link from 'next/link';
import { Bot, Code2, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';

export function DashboardPage() {
  const t = useTranslations('dashboard.overview');
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-muted-foreground" />
              <CardTitle>{t('connectCard.title')}</CardTitle>
            </div>
            <CardDescription>{t('connectCard.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm">
              https://mcp.getmunin.com
            </code>
            <p className="text-xs text-muted-foreground">{t('connectCard.consentNote')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Code2 className="size-5 text-muted-foreground" />
              <CardTitle>{t('buildCard.title')}</CardTitle>
            </div>
            <CardDescription>{t('buildCard.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" render={<Link href="/dashboard/settings/api-keys" />}>
              <KeyRound className="size-4" />
              {t('buildCard.cta')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
