import Link from 'next/link';
import { Button } from '@getmunin/ui';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6">
      <div className="space-y-6">
        <h1 className="text-5xl font-semibold tracking-tight">Munin</h1>
        <p className="max-w-xl text-xl text-muted-foreground">
          Agent-native business apps. The AI agent is the UI.
        </p>
        <p className="text-sm text-muted-foreground">
          Knowledge Base · Conversations · CRM · CMS — open source, MCP-first.
        </p>
        <div className="flex gap-3 pt-4">
          <Button size="lg" render={<Link href="/signup" />}>
            Get started
          </Button>
          <Button size="lg" variant="outline" render={<Link href="/login" />}>
            Sign in
          </Button>
        </div>
        <div className="pt-2 text-sm">
          <Link href="/suggestions" className="text-muted-foreground hover:underline">
            See what the community is asking for →
          </Link>
        </div>
      </div>
    </main>
  );
}
