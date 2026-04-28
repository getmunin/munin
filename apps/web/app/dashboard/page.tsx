'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Code2, KeyRound, LogOut } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) {
    return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <span className="text-lg font-semibold tracking-tight">Munin</span>
          <UserMenu
            email={session.user.email}
            name={session.user.name ?? session.user.email}
            image={session.user.image ?? null}
            onSignOut={() => {
              void (async () => {
                await authClient.signOut();
                router.push('/login');
              })();
            }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Munin</h1>
          <p className="text-sm text-muted-foreground">
            Connect your AI agent or build a server-side integration.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bot className="size-5 text-muted-foreground" />
                <CardTitle>Connect your AI agent</CardTitle>
              </div>
              <CardDescription>
                Add this URL to Claude Desktop, Cursor, or any MCP client.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm">
                https://mcp.getmunin.com
              </code>
              <p className="text-xs text-muted-foreground">
                You'll see a consent screen here when an agent connects.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Code2 className="size-5 text-muted-foreground" />
                <CardTitle>Build a server integration</CardTitle>
              </div>
              <CardDescription>
                Voice AI, web chatbot, or mobile app? Mint short-lived end-user tokens server-side.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled className="w-full">
                <KeyRound className="size-4" />
                Create API key (coming soon)
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

interface UserMenuProps {
  email: string;
  name: string;
  image: string | null;
  onSignOut: () => void;
}

function UserMenu({ email, name, image, onSignOut }: UserMenuProps) {
  const initials = name
    .split(' ')
    .map((part) => part[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 gap-2 px-2" />}>
        <Avatar className="size-7">
          {image && <AvatarImage src={image} alt={name} />}
          <AvatarFallback>{initials || '?'}</AvatarFallback>
        </Avatar>
        <span className="hidden text-sm font-medium sm:inline">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <span className="text-sm font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">{email}</span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
