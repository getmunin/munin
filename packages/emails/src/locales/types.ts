export type EmailLocale = 'en' | 'nb';

export const EMAIL_LOCALES: readonly EmailLocale[] = ['en', 'nb'] as const;

export function defaultEmailLocale(): EmailLocale {
  const env = (process.env.MUNIN_DEFAULT_LOCALE ?? 'en').toLowerCase();
  return env === 'nb' ? 'nb' : 'en';
}

export function isEmailLocale(value: unknown): value is EmailLocale {
  return value === 'en' || value === 'nb';
}

export interface SharedStrings {
  fallbackPrefix: string;
  footerLegal: string;
  footerHelp: string;
  footerPrivacy: string;
}
