import { Suspense } from 'react';
import {
  fetchAuthProviders,
  SignupForm,
  OSS_AUTH_FOOTER,
} from '@getmunin/dashboard-pages';

export default async function SignupPage() {
  const providers = await fetchAuthProviders();
  return (
    <Suspense fallback={null}>
      <SignupForm providers={providers} footer={OSS_AUTH_FOOTER} />
    </Suspense>
  );
}
