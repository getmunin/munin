import { Suspense } from 'react';
import { fetchAuthProviders } from '@getmunin/dashboard-pages';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const providers = await fetchAuthProviders();
  return (
    <Suspense fallback={null}>
      <LoginForm providers={providers} />
    </Suspense>
  );
}
