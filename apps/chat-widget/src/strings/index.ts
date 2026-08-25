import en from './en.ts';
import nb from './nb.ts';
import nn from './nn.ts';
import da from './da.ts';
import sv from './sv.ts';
import fi from './fi.ts';
import is from './is.ts';
import et from './et.ts';
import lv from './lv.ts';
import lt from './lt.ts';
import de from './de.ts';
import fr from './fr.ts';
import es from './es.ts';
import it from './it.ts';
import pt from './pt.ts';
import nl from './nl.ts';
import pl from './pl.ts';
import cs from './cs.ts';
import sk from './sk.ts';
import hu from './hu.ts';
import ro from './ro.ts';
import type { Strings } from './types.ts';

export const LOCALES: Record<string, Strings> = {
  en,
  nb,
  nn,
  da,
  sv,
  fi,
  is,
  et,
  lv,
  lt,
  de,
  fr,
  es,
  it,
  pt,
  nl,
  pl,
  cs,
  sk,
  hu,
  ro,
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
  return { locale: DEFAULT_LOCALE, strings: en };
}

const LOCALE_ALIASES: Record<string, string> = {
  no: 'nb',
  nob: 'nb',
  nor: 'nb',
  nno: 'nn',
};

function normalizeTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const short = lower.split('-')[0] ?? lower;
  if (!short) return null;
  return LOCALE_ALIASES[short] ?? short;
}

export { format, isPluralValue, type PluralValue, type Strings, type StringValue } from './types.ts';
