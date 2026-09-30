'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';

export interface InvitationLookup {
  email: string;
  role: string;
  expiresAt: string;
  orgName: string | null;
  hasAccount: boolean;
}

export type InvitationLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; invitation: InvitationLookup }
  | { status: 'invalid' }
  | { status: 'failed' };

export function extractInviteToken(redirectRaw: string | null): string | null {
  if (!redirectRaw) return null;
  if (!redirectRaw.startsWith('/accept-invite')) return null;
  try {
    const url = new URL(redirectRaw, 'http://placeholder');
    return url.searchParams.get('token');
  } catch {
    return null;
  }
}

export function isInvalidInvitationError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 400 || err.status === 404);
}

export function inviteAuthHref(path: '/login' | '/signup', token: string): string {
  const redirect = `/accept-invite?token=${encodeURIComponent(token)}`;
  return `${path}?redirect=${encodeURIComponent(redirect)}`;
}

export function lookupInvitation(token: string): Promise<InvitationLookup> {
  return api<InvitationLookup>(`/v1/invitations/lookup?token=${encodeURIComponent(token)}`);
}

export function useInvitationLookup(token: string | null, enabled = true): InvitationLookupState {
  const [state, setState] = useState<InvitationLookupState>({ status: 'idle' });

  useEffect(() => {
    if (!token || !enabled) return;
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const invitation = await lookupInvitation(token);
        if (!cancelled) setState({ status: 'found', invitation });
      } catch (err) {
        if (!cancelled) setState({ status: isInvalidInvitationError(err) ? 'invalid' : 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, enabled]);

  return state;
}
