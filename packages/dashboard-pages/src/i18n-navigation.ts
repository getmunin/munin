import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';
import { BASE_LOCALES } from './messages';

const routing = defineRouting({
  locales: BASE_LOCALES,
  defaultLocale: 'en',
  localePrefix: 'always',
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
