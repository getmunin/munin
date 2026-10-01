import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkConsentOrgBinding } from './consent-org-binding';
import { api, ApiError } from '../api';
import type * as ApiModule from '../api';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

const apiMock = vi.mocked(api);

function respond(pending: unknown, memberships: unknown): void {
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith('/v1/oauth/pending-org')) return Promise.resolve(pending);
    if (path === '/v1/me/memberships') return Promise.resolve(memberships);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

describe('checkConsentOrgBinding', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('flags a request pinned to an org the signed-in user does not belong to', async () => {
    respond({ pinned: true, orgId: 'org_theirs' }, [{ orgId: 'org_mine' }]);
    await expect(checkConsentOrgBinding('challenge')).resolves.toEqual({
      status: 'foreign',
      orgId: 'org_theirs',
    });
  });

  it('leaves a request pinned to one of the user’s own orgs open', async () => {
    respond({ pinned: true, orgId: 'org_mine' }, [{ orgId: 'org_other' }, { orgId: 'org_mine' }]);
    await expect(checkConsentOrgBinding('challenge')).resolves.toEqual({ status: 'open' });
  });

  it('leaves an unpinned request open', async () => {
    respond({ pinned: false }, [{ orgId: 'org_mine' }]);
    await expect(checkConsentOrgBinding('challenge')).resolves.toEqual({ status: 'open' });
  });

  it('asks nothing without a code challenge to correlate on', async () => {
    await expect(checkConsentOrgBinding('')).resolves.toEqual({ status: 'open' });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('fails open when a lookup errors, since the token is refused downstream anyway', async () => {
    apiMock.mockRejectedValue(
      new ApiError({
        status: 503,
        statusText: 'error',
        endpoint: '/v1/oauth/pending-org',
        method: 'GET',
        requestId: null,
        message: 'error',
      }),
    );
    await expect(checkConsentOrgBinding('challenge')).resolves.toEqual({ status: 'open' });
  });

  it('reads both endpoints without the tab’s org header', async () => {
    respond({ pinned: false }, []);
    await checkConsentOrgBinding('a b');
    expect(apiMock).toHaveBeenCalledWith('/v1/oauth/pending-org?code_challenge=a%20b', {
      crossOrg: true,
    });
    expect(apiMock).toHaveBeenCalledWith('/v1/me/memberships', { crossOrg: true });
  });
});
