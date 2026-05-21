import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';

const routing = defineRouting({
  locales: ['en', 'nb'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
