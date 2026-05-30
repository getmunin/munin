import { Suspense } from 'react';
import {
  fetchAuthProviders,
  LoginForm,
  OSS_AUTH_FOOTER,
} from '@getmunin/dashboard-pages';

export default async function LoginPage() {
  const providers = await fetchAuthProviders();
  return (
    <Suspense fallback={null}>
      <LoginForm providers={providers} footer={OSS_AUTH_FOOTER} />
    </Suspense>
  );
}
