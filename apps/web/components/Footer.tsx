'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function Footer() {
  const pathname = usePathname();
  const t = useTranslations('footer');

  if (pathname?.startsWith('/dashboard')) return null;
  if (pathname === '/login' || pathname === '/signup') return null;
  if (pathname?.startsWith('/accept-invite')) return null;

  return (
    <footer className="border-t border-rule-soft px-6 py-5 text-xs text-ink-mute dark:border-rule-on-dark">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-eyebrow">
          © {new Date().getFullYear()} Munin
        </span>
        <div className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-eyebrow">
          <Link href="/privacy" className="hover:text-ink dark:hover:text-foreground">
            {t('privacy')}
          </Link>
          <Link href="/terms" className="hover:text-ink dark:hover:text-foreground">
            {t('terms')}
          </Link>
          <a
            href="https://github.com/getmunin/munin"
            className="hover:text-ink dark:hover:text-foreground"
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
