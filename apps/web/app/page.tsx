import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';

export default function HomePage() {
  const t = useTranslations('home');
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6">
      <div className="space-y-6">
        <h1 className="text-5xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="max-w-xl text-xl text-muted-foreground">{t('tagline')}</p>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <div className="flex gap-3 pt-4">
          <Button size="lg" render={<Link href="/signup" />}>
            {t('getStarted')}
          </Button>
          <Button size="lg" variant="outline" render={<Link href="/login" />}>
            {t('signIn')}
          </Button>
        </div>
      </div>
    </main>
  );
}
