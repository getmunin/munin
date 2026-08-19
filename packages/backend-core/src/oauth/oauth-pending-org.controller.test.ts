import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ActorIdentity, withContext } from '@getmunin/core';
import { OAuthPendingOrgController } from './oauth-pending-org.controller.ts';
import {
  buildOrgScopeAssociationKey,
  registerOrgScopeStore,
  type OrgScopeStore,
} from '../auth/org-scope-store.ts';

const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaa';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const SECRET = 'pending-org-controller-secret-0000000000';
const COOKIE = 'better-auth.session_token=owner-session.signature';
const OTHER_COOKIE = 'better-auth.session_token=other-session.signature';

function storeHolding(associations: Record<string, string>): OrgScopeStore {
  return {
    keyFor: (cookieHeader, codeChallenge) =>
      buildOrgScopeAssociationKey(SECRET, cookieHeader, codeChallenge),
    remember: () => Promise.resolve(),
    recall: (key) => Promise.resolve(associations[key] ?? null),
  };
}

function requestWith(cookie?: string) {
  return { headers: cookie === undefined ? {} : { cookie } };
}

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  const actor = new ActorIdentity('user', 'usr_1', ORG_A, ['*'], ['admin'], undefined, undefined, undefined, 'usr_1');
  return withContext({ db: {} as never, actor, correlationId: 'test' }, fn);
}

describe('OAuthPendingOrgController', () => {
  beforeEach(() => {
    registerOrgScopeStore(
      storeHolding({ [buildOrgScopeAssociationKey(SECRET, COOKIE, CHALLENGE)!]: ORG_A }),
    );
  });
  afterEach(() => registerOrgScopeStore(null));

  it('reports the org a pending authorization will bind to', async () => {
    const result = await asUser(() =>
      new OAuthPendingOrgController().pending(requestWith(COOKIE), CHALLENGE),
    );
    expect(result).toEqual({ pinned: true, orgId: ORG_A });
  });

  it('reports nothing pinned for an authorization that named no org', async () => {
    const result = await asUser(() =>
      new OAuthPendingOrgController().pending(requestWith(COOKIE), 'a-different-challenge'),
    );
    expect(result).toEqual({ pinned: false });
  });

  it('does not reveal another session\'s pending org', async () => {
    const result = await asUser(() =>
      new OAuthPendingOrgController().pending(requestWith(OTHER_COOKIE), CHALLENGE),
    );
    expect(result).toEqual({ pinned: false });
  });

  it('reports nothing pinned without a session cookie or a challenge', async () => {
    await expect(
      asUser(() => new OAuthPendingOrgController().pending(requestWith(), CHALLENGE)),
    ).resolves.toEqual({ pinned: false });
    await expect(
      asUser(() => new OAuthPendingOrgController().pending(requestWith(COOKIE), undefined)),
    ).resolves.toEqual({ pinned: false });
  });

  it('refuses a non-user credential', async () => {
    const actor = new ActorIdentity('admin_agent', 'akey_1', ORG_A, ['*'], ['admin']);
    await expect(
      withContext({ db: {} as never, actor, correlationId: 'test' }, () =>
        new OAuthPendingOrgController().pending(requestWith(COOKIE), CHALLENGE),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports nothing pinned when no store is registered', async () => {
    registerOrgScopeStore(null);
    await expect(
      asUser(() => new OAuthPendingOrgController().pending(requestWith(COOKIE), CHALLENGE)),
    ).resolves.toEqual({ pinned: false });
  });
});
