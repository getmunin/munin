'use client';

import { useTranslations } from 'next-intl';
import type { AuthState, AuthFooter } from './epigraphs';

const STATE_TO_VARIANT: Record<AuthState, string> = {
  login: 'login',
  'login-error': 'loginError',
  signup: 'signup',
  forgot: 'forgot',
  reset: 'reset',
  'reset-done': 'reset',
  invite: 'invite',
  'invite-bad': 'inviteBad',
};

interface AuthEpigraphProps {
  state: AuthState;
  footer: AuthFooter;
}

export function AuthEpigraph({ state, footer }: AuthEpigraphProps) {
  const t = useTranslations('auth.epigraphs');
  const tCite = useTranslations('auth');
  const variant = STATE_TO_VARIANT[state];

  return (
    <aside className="relative hidden bg-bone md:flex md:items-center md:px-20 md:py-24">
      <div className="max-w-[620px]">
        <div className="mb-[18px] font-mono text-[11px] uppercase tracking-eyebrow text-ink-mute">
          {t(`${variant}.eyebrow`)}
        </div>
        <blockquote className="m-0 font-serif italic text-[clamp(28px,2.6vw,40px)] leading-[1.2] tracking-[-0.01em] text-ink">
          {t(`${variant}.quote`)}
        </blockquote>
        <cite className="mt-7 block font-mono text-[12px] not-italic tracking-wide text-ink-soft before:content-['—_']">
          {tCite('cite')}
        </cite>
      </div>
      <div className="absolute bottom-8 right-14 inline-flex items-center gap-[18px] font-mono text-[11px] text-ink-mute">
        {footer.map((line, idx) => (
          <span key={line} className="contents">
            {idx > 0 && <span className="text-rule-soft">·</span>}
            <span>{line}</span>
          </span>
        ))}
      </div>
    </aside>
  );
}
