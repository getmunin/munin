'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '../i18n-navigation';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { authClient } from '../auth-client';
import { api } from '../api';
import { useTranslateError } from '../i18n/translate-error';
import {
  AuthShell,
  AuthEpigraph,
  AuthInviteCard,
  type AuthFooter,
  OSS_AUTH_FOOTER,
} from '../components/auth-shell';

interface AcceptInvitePageProps {
  footer?: AuthFooter;
}

function AcceptInviteInner({ footer }: { footer: AuthFooter }) {
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
        await api('/v1/invitations/accept', {
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

  const epigraphState = status === 'error' ? 'invite-bad' : 'invite';

  if (status === 'accepted') {
    return (
      <AuthShell
        variant="invite"
        rightZone={<AuthEpigraph state="invite" footer={footer} />}
        leftZone={
          <AuthInviteCard
            tone="good"
            badge={t('acceptedTitle')}
            title={t('acceptedBody')}
            body={null}
            primary={
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2.5 border-[1px] border-ink bg-ink px-[22px] py-3.5 text-[15px] font-medium text-paper transition-colors duration-fast ease-munin hover:border-cobalt-deep hover:bg-cobalt-deep"
              >
                {t('goToDashboard')}
                <ArrowRight className="size-4" strokeWidth={2} />
              </Link>
            }
          />
        }
      />
    );
  }

  if (status === 'error') {
    return (
      <AuthShell
        variant="invite"
        rightZone={<AuthEpigraph state="invite-bad" footer={footer} />}
        leftZone={
          <AuthInviteCard
            tone="bad"
            badge={t('errorTitle')}
            title={message ?? tCommon('unknownError')}
            body={null}
            primary={
              <Link
                href={session ? '/dashboard' : '/login'}
                className="inline-flex items-center gap-2 border-[1px] border-ink bg-transparent px-[18px] py-3 text-[14px] text-ink transition-colors duration-fast ease-munin hover:bg-ink hover:text-paper"
              >
                <ArrowLeft className="size-3.5" strokeWidth={2} />
                {session ? t('backToDashboard') : t('errors.expired')}
              </Link>
            }
            secondary={
              session ? (
                <button
                  type="button"
                  className="bg-transparent text-[14px] text-ink-soft hover:text-ink"
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
                </button>
              ) : null
            }
          />
        }
      />
    );
  }

  return (
    <AuthShell
      variant="invite"
      rightZone={<AuthEpigraph state={epigraphState} footer={footer} />}
      leftZone={
        <AuthInviteCard
          tone="good"
          badge={t('pendingTitle')}
          title={t('pendingBody')}
          body={null}
        />
      }
    />
  );
}

export function AcceptInvitePage({ footer = OSS_AUTH_FOOTER }: AcceptInvitePageProps = {}) {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner footer={footer} />
    </Suspense>
  );
}

