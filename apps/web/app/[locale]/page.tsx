import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Button, Eyebrow } from '@getmunin/ui';

export default function HomePage() {
  const t = useTranslations('home');
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 bg-bone dark:bg-background">
      <div className="space-y-8">
        <Eyebrow tone="muted">MCP-first · EU-hosted · MIT</Eyebrow>
        <h1 className="font-serif text-6xl md:text-7xl leading-[0.95] font-normal tracking-tight text-ink dark:text-foreground">
          {t('title')}<span className="text-cobalt dark:text-cobalt-soft">.</span>
        </h1>
        <p className="max-w-xl font-serif text-2xl leading-snug italic text-cobalt dark:text-cobalt-soft">
          {t('tagline')}
        </p>
        <p className="max-w-xl text-base text-ink-soft dark:text-foreground/80">{t('subtitle')}</p>
        <div className="flex gap-3 pt-2">
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
