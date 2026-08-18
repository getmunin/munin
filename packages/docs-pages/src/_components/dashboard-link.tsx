import type { ComponentProps, ReactNode } from 'react';
import { Link } from '../i18n-navigation';
import { stripTrailingSlashes } from '@getmunin/types';

const APP_URL = stripTrailingSlashes(process.env.NEXT_PUBLIC_APP_URL ?? '');

export function DashboardLink({
  href,
  children,
  ...rest
}: Omit<ComponentProps<'a'>, 'href'> & { href: string; children: ReactNode }) {
  if (!APP_URL) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={`${APP_URL}${href}`} {...rest}>
      {children}
    </a>
  );
}
