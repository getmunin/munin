import { api } from '../api';

interface PendingAuthorizationOrg {
  pinned: boolean;
  orgId?: string;
}

interface MembershipRow {
  orgId: string;
}

export type ConsentOrgBinding = { status: 'open' } | { status: 'foreign'; orgId: string };

export async function checkConsentOrgBinding(codeChallenge: string): Promise<ConsentOrgBinding> {
  if (!codeChallenge) return { status: 'open' };
  try {
    const [pending, memberships] = await Promise.all([
      api<PendingAuthorizationOrg>(
        `/v1/oauth/pending-org?code_challenge=${encodeURIComponent(codeChallenge)}`,
        { crossOrg: true },
      ),
      api<MembershipRow[]>('/v1/me/memberships', { crossOrg: true }),
    ]);
    const orgId = pending.pinned ? pending.orgId : undefined;
    if (!orgId) return { status: 'open' };
    return memberships.some((m) => m.orgId === orgId)
      ? { status: 'open' }
      : { status: 'foreign', orgId };
  } catch {
    return { status: 'open' };
  }
}
