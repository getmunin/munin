import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export async function Footer() {
  const t = await getTranslations('footer');
  return (
    <footer className="border-t border-border/60 px-4 py-6 text-xs text-muted-foreground">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
        <span>© {new Date().getFullYear()} Munin</span>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:underline">
            {t('privacy')}
          </Link>
          <Link href="/terms" className="hover:underline">
            {t('terms')}
          </Link>
          <a
            href="https://github.com/getmunin/munin"
            className="hover:underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </div>
      </nav>
    </footer>
  );
}
