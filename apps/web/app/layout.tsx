import type { Metadata } from 'next';
import './globals.css';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { Footer } from '../components/Footer';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return {
    title: t('title'),
    description: t('description'),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className="font-sans antialiased">
      <body className="flex min-h-screen flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <div className="flex-1">{children}</div>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
