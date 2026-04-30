import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './locales';

function negotiateFromHeader(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const tags = acceptLanguage
    .split(',')
    .map((p) => (p.split(';')[0] ?? '').trim().toLowerCase())
    .filter((s) => s.length > 0);
  for (const tag of tags) {
    const primary = tag.split('-')[0] ?? tag;
    if (isLocale(primary)) return primary;
    if (primary === 'no' || primary === 'nn') return 'nb';
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const fromHeader = negotiateFromHeader((await headers()).get('accept-language'));
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : fromHeader;
  const mod = (await import(`../messages/${locale}.json`)) as { default: Record<string, unknown> };
  return { locale, messages: mod.default };
});
