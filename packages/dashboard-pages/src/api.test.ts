import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ORG_ACCESS_DENIED_CODE, ORG_HEADER } from '@getmunin/types';
import { api } from './api';
import { clearActiveOrgId, getActiveOrgId, setActiveOrgId } from './auth/active-org';

function installSessionStorage(): void {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
  Object.defineProperty(globalThis, 'window', {
    value: { sessionStorage: storage },
    configurable: true,
    writable: true,
  });
}

function jsonResponse(
  body: unknown,
  init: { status?: number; orgHeader?: string } = {},
): Response {
  const headers: Record<string, string> = {};
  if (init.orgHeader) headers[ORG_HEADER] = init.orgHeader;
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function orgOf(call: unknown[]): string | undefined {
  const init = call[1] as RequestInit;
  return (init.headers as Record<string, string>)[ORG_HEADER];
}

describe('api org scoping', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    installSessionStorage();
    clearActiveOrgId();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pins the tab to the org that served the first response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, { orgHeader: 'org_a' }));
    await api('/v1/me/memberships');
    expect(orgOf(fetchMock.mock.calls[0]!)).toBeUndefined();
    expect(getActiveOrgId()).toBe('org_a');
  });

  it('sends the pinned org on every later request', async () => {
    setActiveOrgId('org_a');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, { orgHeader: 'org_a' }));
    await api('/v1/kb/spaces');
    expect(orgOf(fetchMock.mock.calls[0]!)).toBe('org_a');
  });

  it('leaves a pinned tab alone when another tab switches org', async () => {
    setActiveOrgId('org_a');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, { orgHeader: 'org_a' }));
    await api('/v1/kb/spaces');
    expect(getActiveOrgId()).toBe('org_a');
  });

  it('drops the pin and retries once when the server refuses the org', async () => {
    setActiveOrgId('org_gone');
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ message: 'nope', code: ORG_ACCESS_DENIED_CODE }, { status: 403 }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }, { orgHeader: 'org_current' }));

    await expect(api('/v1/kb/spaces')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(orgOf(fetchMock.mock.calls[0]!)).toBe('org_gone');
    expect(orgOf(fetchMock.mock.calls[1]!)).toBeUndefined();
    expect(getActiveOrgId()).toBe('org_current');
  });

  it('does not retry a 403 that is not about org access', async () => {
    setActiveOrgId('org_a');
    fetchMock.mockResolvedValue(
      jsonResponse({ message: 'forbidden', code: 'FORBIDDEN' }, { status: 403 }),
    );
    await expect(api('/v1/kb/spaces')).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getActiveOrgId()).toBe('org_a');
  });

  it('never sends the org header on anonymous requests', async () => {
    setActiveOrgId('org_a');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, { orgHeader: 'org_a' }));
    await api('/v1/public/mcp-tools', { anonymous: true });
    expect(orgOf(fetchMock.mock.calls[0]!)).toBeUndefined();
  });
});
