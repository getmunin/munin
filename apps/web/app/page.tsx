import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Munin</h1>
      <p className="mt-4 text-lg text-neutral-700">
        Agent-native business apps. The AI agent is the UI.
      </p>
      <p className="mt-8 text-sm text-neutral-500">
        Knowledge Base · Helpdesk · CRM — open source, MCP-first.
      </p>
      <div className="mt-12 flex gap-3">
        <Link
          href="/signup"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
