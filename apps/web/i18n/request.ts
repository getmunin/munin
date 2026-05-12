import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';
import { DEFAULT_LOCALE, type Locale } from './locales';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : DEFAULT_LOCALE;
  const mod = (await import(`../messages/${locale}.json`)) as { default: Record<string, unknown> };
  return { locale, messages: mod.default, now: new Date() };
});
