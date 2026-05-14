import en from './en.js';
import nb from './nb.js';
import da from './da.js';
import sv from './sv.js';
import fi from './fi.js';
import is from './is.js';
import de from './de.js';
import fr from './fr.js';
import es from './es.js';
import it from './it.js';
import pt from './pt.js';
import nl from './nl.js';
import pl from './pl.js';
import type { Strings } from './types.js';

export const LOCALES: Record<string, Strings> = {
  en,
  nb,
  da,
  sv,
  fi,
  is,
  de,
  fr,
  es,
  it,
  pt,
  nl,
  pl,
};

export const SUPPORTED_LOCALES = Object.keys(LOCALES) as ReadonlyArray<keyof typeof LOCALES>;
export const DEFAULT_LOCALE = 'en';

export function pickLocale(prefer?: string | null): { locale: string; strings: Strings } {
  const preferred = normalizeTag(prefer);
  const fromPrefer = preferred ? LOCALES[preferred] : undefined;
  if (fromPrefer) {
    return { locale: preferred!, strings: fromPrefer };
  }
  if (typeof navigator !== 'undefined') {
    const candidates = [navigator.language, ...(navigator.languages ?? [])].filter(
      (l): l is string => typeof l === 'string',
    );
    for (const raw of candidates) {
      const tag = normalizeTag(raw);
      const match = tag ? LOCALES[tag] : undefined;
      if (tag && match) {
        return { locale: tag, strings: match };
      }
    }
  }
  return { locale: DEFAULT_LOCALE, strings: LOCALES[DEFAULT_LOCALE] };
}

function normalizeTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const short = lower.split('-')[0] ?? lower;
  return short || null;
}

export { format, isPluralValue, type PluralValue, type Strings, type StringValue } from './types.js';
