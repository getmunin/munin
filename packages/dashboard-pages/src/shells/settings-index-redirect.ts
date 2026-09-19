import { orgDashboardPath } from '@getmunin/types';
import { redirect } from '../navigation-routing';
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
    params: Promise<{ locale: string; orgId?: string }>;
  }) {
    const { locale, orgId } = await params;
    redirect({
      href: orgId ? orgDashboardPath(target, orgId) : target,
      locale: locale || defaultLocale,
    });
  };
}
