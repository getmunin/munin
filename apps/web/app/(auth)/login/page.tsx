'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@getmunin/dashboard-pages';
import { GoogleButton } from '@getmunin/ui';
import { Button } from '@getmunin/ui';
import { Input } from '@getmunin/ui';
import { Label } from '@getmunin/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@getmunin/ui';
import { Separator } from '@getmunin/ui';

function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/dashboard';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectRaw = params.get('redirect');
  const redirectTo = safeRedirect(redirectRaw);
  const signupHref = redirectRaw
    ? `/signup?redirect=${encodeURIComponent(redirectRaw)}`
    : '/signup';
  const { refetch } = authClient.useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? 'Sign-in failed');
        return;
      }
      await refetch();
      router.push(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — is the API reachable?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-0 shadow-none sm:border sm:shadow-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>Welcome back to Munin.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GoogleButton
          onSignIn={() => {
            void authClient.signIn.social({ provider: 'google', callbackURL: redirectTo });
          }}
        />

        <DividerWithLabel label="or" />

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="pt-2 text-sm text-muted-foreground">
          New here?{' '}
          <Link href={signupHref} className="font-medium text-foreground underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function DividerWithLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <Separator className="flex-1" />
      {label}
      <Separator className="flex-1" />
    </div>
  );
}
