import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ActorIdentity, withContext } from '@getmunin/core';
import { OAuthPendingOrgController } from './oauth-pending-org.controller.ts';
import {
  buildOrgScopeAssociationKeys,
  registerOrgScopeStore,
  type OrgScopeAssociationKeys,
  type OrgScopeStore,
} from '../auth/org-scope-store.ts';

const ORG_A = 'org_aaaaaaaaaaaaaaaaaaaaaa';
const ORG_B = 'org_bbbbbbbbbbbbbbbbbbbbbb';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const SECRET = 'pending-org-controller-secret-0000000000';
const COOKIE = 'better-auth.session_token=owner-session.signature';
const OTHER_COOKIE = 'better-auth.session_token=other-session.signature';

const keysOf = (cookie: string | undefined, challenge: string | undefined) =>
  buildOrgScopeAssociationKeys(SECRET, cookie, challenge);

function storeHolding(associations: Record<string, string>): OrgScopeStore {
  return {
    keysFor: (cookieHeader, codeChallenge) =>
      buildOrgScopeAssociationKeys(SECRET, cookieHeader, codeChallenge),
    remember: () => Promise.resolve(),
    recall: (keys: OrgScopeAssociationKeys) =>
      Promise.resolve(
        (keys.session ? associations[keys.session] : undefined) ??
          (keys.challenge ? associations[keys.challenge] : undefined) ??
          null,
      ),
  };
}

function requestWith(cookie?: string) {
  return { headers: cookie === undefined ? {} : { cookie } };
}

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  const actor = new ActorIdentity(
    'user',
    'usr_1',
    ORG_A,
    ['*'],
    ['admin'],
    undefined,
    undefined,
    undefined,
    'usr_1',
  );
  return withContext({ db: {} as never, actor, correlationId: 'test' }, fn);
}

describe('OAuthPendingOrgController', () => {
  beforeEach(() => {
    registerOrgScopeStore(storeHolding({ [keysOf(COOKIE, CHALLENGE).session!]: ORG_A }));
  });
  afterEach(() => registerOrgScopeStore(null));

  it('reports the org a pending authorization will bind to', async () => {
    const result = await asUser(() =>
      new OAuthPendingOrgController().pending(requestWith(COOKIE), CHALLENGE),
    );
    expect(result).toEqual({ pinned: true, orgId: ORG_A });
  });

  it('reports an association written before the caller signed in', async () => {
    registerOrgScopeStore(storeHolding({ [keysOf(undefined, CHALLENGE).challenge!]: ORG_B }));
    const result = await asUser(() =>
      new OAuthPendingOrgController().pending(requestWith(COOKIE), CHALLENGE),
    );
    expect(result).toEqual({ pinned: true, orgId: ORG_B });
  });

  it('reports nothing pinned for an authorization that named no org', async () => {
    const result = await asUser(() =>
      new OAuthPendingOrgController().pending(requestWith(COOKIE), 'a-different-challenge'),
    );
    expect(result).toEqual({ pinned: false });
  });

  it('prefers the association this session started over one keyed on the challenge alone', async () => {
    registerOrgScopeStore(
      storeHolding({
        [keysOf(COOKIE, CHALLENGE).session!]: ORG_A,
        [keysOf(undefined, CHALLENGE).challenge!]: ORG_B,
      }),
    );
    await expect(
      asUser(() => new OAuthPendingOrgController().pending(requestWith(COOKIE), CHALLENGE)),
    ).resolves.toEqual({ pinned: true, orgId: ORG_A });
    await expect(
      asUser(() => new OAuthPendingOrgController().pending(requestWith(OTHER_COOKIE), CHALLENGE)),
    ).resolves.toEqual({ pinned: true, orgId: ORG_B });
  });

  it('reports nothing pinned without a challenge', async () => {
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
