import { redirect } from '../i18n-navigation';
import { FIRST_SETTINGS_HREF } from '../nav/settings-groups';

export interface CreateSettingsIndexRedirectOptions {
  defaultLocale: string;
  target?: string;
}

export function createSettingsIndexRedirect({
  defaultLocale,
  target = FIRST_SETTINGS_HREF,
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
