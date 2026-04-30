export type EmailLocale = 'en' | 'nb';

export const EMAIL_LOCALES: EmailLocale[] = ['en', 'nb'];

export function defaultEmailLocale(): EmailLocale {
  const env = (process.env.MUNIN_DEFAULT_LOCALE ?? 'en').toLowerCase();
  return env === 'nb' ? 'nb' : 'en';
}

export function isEmailLocale(value: unknown): value is EmailLocale {
  return value === 'en' || value === 'nb';
}

interface EmailContent {
  subject: string;
  text: string;
}

const RESET_PASSWORD: Record<EmailLocale, (url: string) => EmailContent> = {
  en: (url) => ({
    subject: 'Reset your Munin password',
    text: [
      'You asked to reset your Munin password.',
      '',
      'Click the link below to set a new one (valid for 1 hour):',
      url,
      '',
      "If you didn't request this, you can ignore this email.",
    ].join('\n'),
  }),
  nb: (url) => ({
    subject: 'Tilbakestill Munin-passordet ditt',
    text: [
      'Du har bedt om å tilbakestille Munin-passordet ditt.',
      '',
      'Klikk på lenken nedenfor for å sette et nytt (gyldig i 1 time):',
      url,
      '',
      'Hvis du ikke ba om dette, kan du ignorere denne e-posten.',
    ].join('\n'),
  }),
};

const VERIFY_EMAIL: Record<EmailLocale, (url: string) => EmailContent> = {
  en: (url) => ({
    subject: 'Verify your Munin email',
    text: [
      'Welcome to Munin.',
      '',
      'Confirm your email so we know we can reach you:',
      url,
      '',
      "If you didn't sign up, ignore this email.",
    ].join('\n'),
  }),
  nb: (url) => ({
    subject: 'Bekreft Munin-e-postadressen din',
    text: [
      'Velkommen til Munin.',
      '',
      'Bekreft e-postadressen din slik at vi vet at vi kan nå deg:',
      url,
      '',
      'Hvis du ikke registrerte deg, kan du ignorere denne e-posten.',
    ].join('\n'),
  }),
};

export function resetPasswordEmail(url: string, locale: EmailLocale = defaultEmailLocale()): EmailContent {
  return RESET_PASSWORD[locale](url);
}

export function verifyEmailEmail(url: string, locale: EmailLocale = defaultEmailLocale()): EmailContent {
  return VERIFY_EMAIL[locale](url);
}
