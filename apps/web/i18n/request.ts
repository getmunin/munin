import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import * as rootParamsModule from 'next/root-params';
import { loadBaseMessages } from '@getmunin/dashboard-pages';
import { routing } from './routing';
import { DEFAULT_LOCALE, type Locale } from './locales';

const rootParams = rootParamsModule as unknown as { locale: () => Promise<string | undefined> };

export default getRequestConfig(async () => {
  const requested = await rootParams.locale();
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : DEFAULT_LOCALE;
  const messages = await loadBaseMessages(locale);
  return { locale, messages };
});
