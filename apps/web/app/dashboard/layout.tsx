'use client';

import { useRouter } from 'next/navigation';
import { authClient, useDashboardGate } from '@getmunin/dashboard-pages';
import { PageSpinner } from '@getmunin/ui';
import { MuninTopbar } from '@/components/munin-topbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { ready, role } = useDashboardGate();

  if (!ready || !session) {
    return <PageSpinner className="min-h-screen bg-bone dark:bg-background" />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-bone dark:bg-background">
      <MuninTopbar
        role={role}
        user={{
          email: session.user.email,
          name: session.user.name ?? session.user.email,
          image: session.user.image ?? null,
        }}
        onSignOut={() => {
          void (async () => {
            await authClient.signOut();
            router.push('/login');
          })();
        }}
      />
      <main className="flex-1 bg-paper dark:bg-background">{children}</main>
    </div>
  );
}
