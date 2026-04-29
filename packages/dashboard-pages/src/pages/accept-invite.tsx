'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, MailQuestion } from 'lucide-react';
import { authClient } from '../auth-client';
import { api, ApiError } from '../api';
import { Button } from '@getmunin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';

function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const [status, setStatus] = useState<'idle' | 'pending' | 'accepted' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!token) {
      setStatus('error');
      setMessage('Missing invitation token.');
      return;
    }
    if (!session) {
      // Bounce to signup with a redirect back to this page once signed in.
      const redirect = `/accept-invite?token=${encodeURIComponent(token)}`;
      router.push(`/signup?redirect=${encodeURIComponent(redirect)}` as never);
      return;
    }
    if (status !== 'idle') return;
    setStatus('pending');
    void (async () => {
      try {
        await api('/api/invitations/accept', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        setStatus('accepted');
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof ApiError ? err.message : 'Could not accept invitation.');
      }
    })();
  }, [sessionLoading, session, token, router, status]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      {status === 'accepted' ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-700" />
              <CardTitle>Invitation accepted</CardTitle>
            </div>
            <CardDescription>You&apos;re now a member of the org.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/dashboard" />} className="w-full">
              Go to dashboard
            </Button>
          </CardContent>
        </Card>
      ) : status === 'error' ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MailQuestion className="size-5 text-destructive" />
              <CardTitle>Couldn&apos;t accept the invitation</CardTitle>
            </div>
            <CardDescription className="whitespace-pre-wrap">
              {message ?? 'Unknown error.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href="/dashboard" />} className="w-full">
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Accepting your invitation…</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}

export function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  );
}
