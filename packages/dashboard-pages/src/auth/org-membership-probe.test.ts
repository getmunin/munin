import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasOrgMembership } from './org-membership-probe';
import { api, ApiError } from '../api';
import type * as ApiModule from '../api';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: vi.fn() };
});

const apiMock = vi.mocked(api);

function apiError(status: number): ApiError {
  return new ApiError({
    status,
    statusText: 'error',
    endpoint: '/v1/me/memberships',
    method: 'GET',
    requestId: null,
    message: 'error',
  });
}

describe('hasOrgMembership', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('is true when the signed-in user belongs to an organization', async () => {
    apiMock.mockResolvedValue([{ orgId: 'org_1' }]);
    await expect(hasOrgMembership()).resolves.toBe(true);
  });

  it('is false when the session resolves to no organization yet', async () => {
    apiMock.mockRejectedValue(apiError(401));
    await expect(hasOrgMembership()).resolves.toBe(false);
  });

  it('is false for an empty membership list', async () => {
    apiMock.mockResolvedValue([]);
    await expect(hasOrgMembership()).resolves.toBe(false);
  });

  it('does not strand the user on the pending page when the read fails for another reason', async () => {
    apiMock.mockRejectedValue(apiError(503));
    await expect(hasOrgMembership()).resolves.toBe(true);
  });
});
