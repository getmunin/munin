'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE, isLocale } from './locales';

export async function setLocaleCookie(value: string) {
  if (!isLocale(value)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}
