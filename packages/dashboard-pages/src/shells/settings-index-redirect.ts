import { redirect } from '../i18n-navigation';

export interface CreateSettingsIndexRedirectOptions {
  defaultLocale: string;
  target?: string;
}

export function createSettingsIndexRedirect({
  defaultLocale,
  target = '/dashboard/settings/team',
}: CreateSettingsIndexRedirectOptions) {
  return async function SettingsIndexPage({
    params,
  }: {
    params: Promise<{ locale: string }>;
  }) {
    const { locale } = await params;
    redirect({ href: target, locale: locale || defaultLocale });
  };
}
