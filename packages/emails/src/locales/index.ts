import * as en from './en.ts';
import * as nb from './nb.ts';
import type { EmailLocale } from './types.ts';

export { EMAIL_LOCALES, defaultEmailLocale, isEmailLocale } from './types.ts';
export type { EmailLocale, SharedStrings } from './types.ts';

export const locales = { en, nb };

export function pickLocale(locale: EmailLocale): typeof en {
  return locale === 'nb' ? nb : en;
}
