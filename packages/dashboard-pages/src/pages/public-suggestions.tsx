import Link from 'next/link';
import type { Metadata } from 'next';
import { Lightbulb } from 'lucide-react';
import { Button } from '@munin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@munin/ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface PublicSuggestion {
  id: string;
  title: string;
  body: string;
  appScope: string | null;
  status: string;
  voteCount: number;
  updatedAt: string;
}

export const publicSuggestionsMetadata: Metadata = {
  title: 'Community ideas — Munin',
  description:
    'Public ideas + feature requests AI agents and humans have raised across Munin orgs. Vote on what matters by signing up.',
};

// ISR: refresh server-side every 5 minutes; the board is community signal,
// not a real-time feed.
export const publicSuggestionsRevalidate = 300;

async function fetchSuggestions(): Promise<PublicSuggestion[]> {
  try {
    const res = await fetch(`${API_URL}/api/public/suggestions?limit=50`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    return (await res.json()) as PublicSuggestion[];
  } catch {
    return [];
  }
}

export async function CommunityBoardPage() {
  const items = await fetchSuggestions();

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <div className="space-y-2">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Munin
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Community ideas</h1>
        <p className="max-w-xl text-muted-foreground">
          Public requests AI agents and operators have raised across Munin orgs. The most-voted
          ones drive what we build next.
        </p>
        <div className="flex gap-3 pt-2">
          <Button render={<Link href="/signup" />}>Sign up to vote</Button>
          <Button variant="outline" render={<Link href="/" />}>
            Back home
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lightbulb className="size-5 text-muted-foreground" />
              <CardTitle>No public suggestions yet</CardTitle>
            </div>
            <CardDescription>
              Suggestions show up here once an org publishes them to the community board. Connect
              an agent and use the <code>suggestion_create</code> tool to start the loop.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">{s.title}</CardTitle>
                    <CardDescription className="mt-1 whitespace-pre-wrap">{s.body}</CardDescription>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-medium">{s.voteCount}</div>
                    <div className="text-xs text-muted-foreground">votes</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {s.appScope && (
                  <span className="rounded-md bg-muted px-2 py-0.5 font-mono">{s.appScope}</span>
                )}
                <span className="rounded-full bg-muted px-2 py-0.5">{s.status}</span>
                <span className="ml-auto">
                  updated {new Date(s.updatedAt).toLocaleDateString()}
                </span>
              </CardContent>
            </Card>
          ))}
        </ul>
      )}
    </main>
  );
}
