'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, MailQuestion } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { authClient } from '../auth-client';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import { Button } from '@getmunin/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@getmunin/ui';

function AcceptInviteInner() {
  const t = useTranslations('acceptInvite');
  const tCommon = useTranslations('common');
  const translate = useTranslateError();
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
      setMessage(t('missingToken'));
      return;
    }
    if (!session) {
      const redirect = `/accept-invite?token=${encodeURIComponent(token)}`;
      router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
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
        setMessage(translate(err) || t('errors.accept'));
      }
    })();
  }, [sessionLoading, session, token, router, status, t, translate]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      {status === 'accepted' ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-700" />
              <CardTitle>{t('acceptedTitle')}</CardTitle>
            </div>
            <CardDescription>{t('acceptedBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/dashboard" />} className="w-full">
              {t('goToDashboard')}
            </Button>
          </CardContent>
        </Card>
      ) : status === 'error' ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MailQuestion className="size-5 text-destructive" />
              <CardTitle>{t('errorTitle')}</CardTitle>
            </div>
            <CardDescription className="whitespace-pre-wrap">
              {message ?? tCommon('unknownError')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {session && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  void (async () => {
                    await authClient.signOut();
                    if (token) {
                      router.push(`/accept-invite?token=${encodeURIComponent(token)}`);
                    } else {
                      router.push('/login');
                    }
                  })();
                }}
              >
                {t('signOutAndRetry')}
              </Button>
            )}
            <Button variant="outline" render={<Link href="/dashboard" />} className="w-full">
              {t('backToDashboard')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('pendingTitle')}</CardTitle>
            <CardDescription>{t('pendingBody')}</CardDescription>
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
