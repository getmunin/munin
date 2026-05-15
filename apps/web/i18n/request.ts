import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { loadBaseMessages } from '@getmunin/dashboard-pages';
import { routing } from './routing';
import { DEFAULT_LOCALE, type Locale } from './locales';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : DEFAULT_LOCALE;
  const messages = await loadBaseMessages(locale);
  return { locale, messages, now: new Date() };
});
