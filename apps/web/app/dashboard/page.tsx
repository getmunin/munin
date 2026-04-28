import Link from 'next/link';
import { Bot, Code2, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function DashboardPage() {
  return (
    <>
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
              You&apos;ll see a consent screen here when an agent connects.
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
            <Button className="w-full" render={<Link href="/dashboard/api-keys" />}>
              <KeyRound className="size-4" />
              Manage API keys
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
