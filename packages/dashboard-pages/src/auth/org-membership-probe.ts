import { api, ApiError } from '../api';

export const MEMBERSHIP_PENDING_PATH = '/verify-email?state=pending';

export async function hasOrgMembership(): Promise<boolean> {
  try {
    const memberships = await api<unknown[]>('/v1/me/memberships', { crossOrg: true });
    return memberships.length > 0;
  } catch (err) {
    return !(err instanceof ApiError && err.status === 401);
  }
}
