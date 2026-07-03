import { Suspense } from 'react';
import {
  fetchAuthProviders,
  SignupForm,
  OSS_AUTH_FOOTER,
} from '@getmunin/dashboard-pages';
import { redirectIfAuthenticated } from '@getmunin/dashboard-pages/server';

export default async function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  await redirectIfAuthenticated({ locale, redirectParam: sp.redirect, searchParams: sp });
  const providers = await fetchAuthProviders();
  return (
    <Suspense fallback={null}>
      <SignupForm providers={providers} footer={OSS_AUTH_FOOTER} />
    </Suspense>
  );
}
