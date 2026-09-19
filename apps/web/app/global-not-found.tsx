import './globals.css';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { NotFoundPage, loadBaseMessages } from '@getmunin/dashboard-pages';
import { DEFAULT_LOCALE } from '@/i18n/locales';

export const metadata: Metadata = { title: 'Munin · 404' };

export default async function GlobalNotFound() {
  const messages = await loadBaseMessages(DEFAULT_LOCALE);

  return (
    <html lang={DEFAULT_LOCALE} className="font-sans antialiased">
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
          <NotFoundPage />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
