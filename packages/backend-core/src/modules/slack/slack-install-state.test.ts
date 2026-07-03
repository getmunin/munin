import { describe, it, expect } from 'vitest';
import { signHmac } from '@getmunin/core';
import { verifyInstallState } from './slack.service.ts';

const SECRET = 'test-client-secret';

function makeState(state: { orgId: string; userId: string | null; exp: number }): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${signHmac(payload, SECRET)}`;
}

describe('verifyInstallState', () => {
  it('round-trips a valid state', () => {
    const raw = makeState({ orgId: 'org_1', userId: 'usr_1', exp: Date.now() + 60_000 });
    const state = verifyInstallState(raw, SECRET);
    expect(state).toMatchObject({ orgId: 'org_1', userId: 'usr_1' });
  });

  it('rejects an expired state', () => {
    const raw = makeState({ orgId: 'org_1', userId: null, exp: Date.now() - 1 });
    expect(verifyInstallState(raw, SECRET)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const raw = makeState({ orgId: 'org_1', userId: null, exp: Date.now() + 60_000 });
    const [, sig] = raw.split('.');
    const forged = Buffer.from(
      JSON.stringify({ orgId: 'org_evil', userId: null, exp: Date.now() + 60_000 }),
    ).toString('base64url');
    expect(verifyInstallState(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a wrong secret', () => {
    const raw = makeState({ orgId: 'org_1', userId: null, exp: Date.now() + 60_000 });
    expect(verifyInstallState(raw, 'other-secret')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(verifyInstallState('garbage', SECRET)).toBeNull();
    expect(verifyInstallState('a.b.c', SECRET)).toBeNull();
    expect(verifyInstallState('', SECRET)).toBeNull();
  });
});
