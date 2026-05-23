import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@getmunin/ui';

export default function HomePage() {
  const t = useTranslations('home');
  return (
    <main className="min-h-screen w-full bg-bone dark:bg-background">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6">
        <div className="space-y-10">
          <Image
            src="/munin-logo.png"
            alt="Munin"
            width={48}
            height={48}
            className="block"
            priority
          />
          <h1 className="font-serif text-5xl md:text-7xl leading-[0.95] font-normal tracking-tight text-ink dark:text-foreground">
            {t.rich('title', {
              accent: (chunks) => (
                <em className="font-serif italic text-cobalt dark:text-cobalt-soft">{chunks}</em>
              ),
            })}
          </h1>
          <p className="max-w-2xl text-base text-ink-soft dark:text-foreground/80">
            {t('subtitle')}
          </p>
          <div className="flex gap-3 pt-2">
            <Button size="lg" render={<Link href="/signup" />}>
              {t('getStarted')}
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/login" />}>
              {t('signIn')}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
