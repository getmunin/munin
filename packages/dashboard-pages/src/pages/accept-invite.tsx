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
  inviteAuthHref,
  useInvitationLookup,
  type InvitationLookup,
} from '../auth/invitation-lookup';
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

  const lookup = useInvitationLookup(token, !sessionLoading && !session);

  useEffect(() => {
    if (sessionLoading) return;
    if (!token) {
      setStatus('error');
      setMessage(t('missingToken'));
      return;
    }
    if (!session) return;
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
  }, [sessionLoading, session, token, status, t, translate]);

  useEffect(() => {
    if (lookup.status === 'invalid') {
      setStatus('error');
      setMessage(t('errors.expired'));
    } else if (lookup.status === 'failed') {
      setStatus('error');
      setMessage(t('errors.lookup'));
    }
  }, [lookup.status, t]);

  const epigraphState = status === 'error' ? 'invite-bad' : 'invite';

  if (status === 'idle' && token && !session && lookup.status === 'found') {
    return (
      <AuthShell
        variant="invite"
        rightZone={<AuthEpigraph state="invite" footer={footer} />}
        leftZone={<InvitationLanding token={token} invitation={lookup.invitation} />}
      />
    );
  }

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
          badge={session ? t('pendingTitle') : t('lookingUpTitle')}
          title={t('pendingBody')}
          body={null}
        />
      }
    />
  );
}

function InvitationLanding({
  token,
  invitation,
}: {
  token: string;
  invitation: InvitationLookup;
}) {
  const t = useTranslations('acceptInvite');
  const roleKey = (['owner', 'admin', 'member'] as const).find((r) => r === invitation.role);
  const href = inviteAuthHref(invitation.hasAccount ? '/login' : '/signup', token);
  return (
    <AuthInviteCard
      tone="good"
      badge={t('invitedBadge')}
      title={
        invitation.orgName
          ? t('invitedTitle', { org: invitation.orgName })
          : t('invitedTitleNoOrg')
      }
      body={
        invitation.hasAccount
          ? t('signInBody', { email: invitation.email })
          : t('createAccountBody', { email: invitation.email })
      }
      meta={[
        { label: t('meta.email'), value: invitation.email },
        { label: t('meta.role'), value: roleKey ? t(`roles.${roleKey}`) : invitation.role },
      ]}
      primary={
        <Link
          href={href}
          className="inline-flex items-center gap-2.5 border-[1px] border-ink bg-ink px-[22px] py-3.5 text-[15px] font-medium text-paper transition-colors duration-fast ease-munin hover:border-cobalt-deep hover:bg-cobalt-deep"
        >
          {invitation.hasAccount ? t('signInCta') : t('createAccountCta')}
          <ArrowRight className="size-4" strokeWidth={2} />
        </Link>
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

