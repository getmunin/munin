import { createContext, useContext } from 'react';
import { inspector as en } from '@getmunin/dashboard-pages/messages/en.json';
import { inspector as nb } from '@getmunin/dashboard-pages/messages/nb.json';

const CATALOGS: Record<string, unknown> = { en, nb };

export const DEFAULT_LOCALE = 'en';

export function resolveLocale(hostLocale: string | undefined): string {
  const candidate = hostLocale || (typeof navigator === 'undefined' ? '' : navigator.language);
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export type Translator = (key: string, params?: Record<string, string | number>) => string;

export function createT(locale: string): Translator {
  const base = locale.toLowerCase().split('-')[0] ?? DEFAULT_LOCALE;
  const catalog = CATALOGS[base] ?? CATALOGS[DEFAULT_LOCALE];
  return (key, params) => {
    let node: unknown = catalog;
    for (const part of key.split('.')) {
      node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
    }
    if (typeof node !== 'string') return key;
    return node.replace(/\{(\w+)\}/g, (match, name: string) =>
      params && name in params ? String(params[name]) : match,
    );
  };
}

const I18nContext = createContext<{ locale: string; t: Translator }>({
  locale: DEFAULT_LOCALE,
  t: createT(DEFAULT_LOCALE),
});

export const I18nProvider = I18nContext.Provider;

export function useI18n() {
  return useContext(I18nContext);
}
