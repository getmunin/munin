import { Suspense } from 'react';
import {
  fetchAuthProviders,
  LoginForm,
  OSS_AUTH_FOOTER,
} from '@getmunin/dashboard-pages';
import { redirectIfAuthenticated } from '@getmunin/dashboard-pages/server';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ redirect?: string | string[] }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  await redirectIfAuthenticated({ locale, redirectParam: sp.redirect });
  const providers = await fetchAuthProviders();
  return (
    <Suspense fallback={null}>
      <LoginForm providers={providers} footer={OSS_AUTH_FOOTER} />
    </Suspense>
  );
}
