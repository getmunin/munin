'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '../../lib/auth-client';

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) {
    return <p className="p-8 text-sm text-neutral-500">Loading…</p>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Munin</h1>
          <p className="text-sm text-neutral-600">Signed in as {session.user.email}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              await authClient.signOut();
              router.push('/login');
            })();
          }}
          className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
        >
          Sign out
        </button>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Connect your AI agent</h2>
        <code className="block rounded bg-neutral-50 p-3 text-xs">
          mcp.getmunin.com
        </code>
        <p className="text-sm text-neutral-600">
          Add this URL to your AI agent (Claude Desktop, Cursor, custom) to start. You'll see a
          consent screen here.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Build a server integration</h2>
        <p className="text-sm text-neutral-600">
          Voice AI, web chatbot, or mobile app? Create an admin API key and use it server-side to
          mint short-lived end-user tokens for your customer-facing agents.
        </p>
        <button
          type="button"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          disabled
        >
          Create API key (coming soon)
        </button>
      </section>
    </main>
  );
}
