'use client';

import { useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface SuggestionDto {
  id: string;
  title: string;
  body: string;
  appScope: string | null;
  status: 'open' | 'planned' | 'in_progress' | 'done' | 'wontfix' | 'duplicate';
  voteCount: number;
  public: boolean;
  createdAt: string;
  updatedAt: string;
}

const STATUSES: SuggestionDto['status'][] = [
  'open',
  'planned',
  'in_progress',
  'done',
  'wontfix',
  'duplicate',
];

export default function SuggestionsPage() {
  const [items, setItems] = useState<SuggestionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<'votes' | 'recent'>('votes');

  async function load() {
    try {
      setError(null);
      const list = await api<SuggestionDto[]>(`/api/suggestions?sort=${sort}`);
      setItems(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load suggestions.');
    }
  }

  useEffect(() => {
    void load();
  }, [sort]);

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api(`/api/suggestions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update suggestion.');
    }
  }

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suggestions</h1>
          <p className="text-sm text-muted-foreground">
            Product feedback your AI agents have created or voted on. Promote one to the public
            community board, or mark stale ideas as duplicates.
          </p>
        </div>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as 'votes' | 'recent')}
        >
          <option value="votes">Most voted</option>
          <option value="recent">Most recent</option>
        </select>
      </header>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {items === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lightbulb className="size-5 text-muted-foreground" />
              <CardTitle>No suggestions yet</CardTitle>
            </div>
            <CardDescription>
              Agents create suggestions via the <code>suggestion_create</code> MCP tool. Once one
              shows up, you can publish it to the community board, change its status, or mark it as
              a duplicate.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <SuggestionCard key={s.id} s={s} onPatch={patch} />
          ))}
        </ul>
      )}
    </>
  );
}

function SuggestionCard({
  s,
  onPatch,
}: {
  s: SuggestionDto;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{s.title}</CardTitle>
            <CardDescription className="mt-1 line-clamp-3 whitespace-pre-wrap">
              {s.body}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <span className="font-medium">{s.voteCount}</span>
            <span className="text-muted-foreground">votes</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-xs">
        {s.appScope && (
          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-muted-foreground">
            {s.appScope}
          </span>
        )}
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={s.status}
          onChange={(e) => {
            void onPatch(s.id, { status: e.target.value });
          }}
        >
          {STATUSES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
        <Button
          variant={s.public ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            void onPatch(s.id, { public: !s.public });
          }}
        >
          {s.public ? 'Published' : 'Publish to community'}
        </Button>
        <span className="ml-auto text-muted-foreground">
          updated {new Date(s.updatedAt).toLocaleDateString()}
        </span>
      </CardContent>
    </Card>
  );
}
