'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AgentSetupPage, authClient } from '@getmunin/dashboard-pages';
import { PageSpinner } from '@getmunin/ui';

export default function SetupRoute() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) {
    return <PageSpinner className="min-h-screen bg-bone dark:bg-background" />;
  }

  return <AgentSetupPage />;
}
