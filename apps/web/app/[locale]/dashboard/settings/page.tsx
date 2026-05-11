import { redirect } from '@/i18n/navigation';
import { DEFAULT_LOCALE } from '@/i18n/locales';

export default async function SettingsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: '/dashboard/settings/team', locale: locale || DEFAULT_LOCALE });
}
