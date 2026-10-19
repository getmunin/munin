import { describe, it, expect } from 'vitest';
import { signHmac } from '@getmunin/core';
import {
  signInstallState,
  signInstallTicket,
  verifyInstallState,
  verifyInstallTicket,
} from './slack.service.ts';

const SECRET = 'test-client-secret';

function stateFor(overrides: Partial<{ orgId: string; userId: string; exp: number; nonce: string }> = {}) {
  return signInstallState(
    { orgId: 'org_1', userId: 'usr_1', exp: Date.now() + 60_000, nonce: 'abc', ...overrides },
    SECRET,
  );
}

function rawSigned(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signHmac(encoded, SECRET)}`;
}

describe('verifyInstallState', () => {
  it('round-trips a valid state with its installer and session nonce', () => {
    expect(verifyInstallState(stateFor(), SECRET)).toMatchObject({
      orgId: 'org_1',
      userId: 'usr_1',
      nonce: 'abc',
    });
  });

  it('rejects an expired state', () => {
    expect(verifyInstallState(stateFor({ exp: Date.now() - 1 }), SECRET)).toBeNull();
  });

  it('rejects a state that carries no session nonce, which is what an unbound link used to mint', () => {
    const legacy = rawSigned({ orgId: 'org_1', userId: null, exp: Date.now() + 60_000 });
    expect(verifyInstallState(legacy, SECRET)).toBeNull();
    expect(verifyInstallState(stateFor({ nonce: '' }), SECRET)).toBeNull();
  });

  it('rejects a start ticket presented as a callback state', () => {
    const ticket = signInstallTicket({ orgId: 'org_1', exp: Date.now() + 60_000 }, SECRET);
    expect(verifyInstallState(ticket, SECRET)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [, sig] = stateFor().split('.');
    const forged = Buffer.from(
      JSON.stringify({
        kind: 'slack_install_state',
        orgId: 'org_evil',
        userId: 'usr_1',
        exp: Date.now() + 60_000,
        nonce: 'abc',
      }),
    ).toString('base64url');
    expect(verifyInstallState(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a wrong secret', () => {
    expect(verifyInstallState(stateFor(), 'other-secret')).toBeNull();
  });

  it('rejects malformed and non-string input', () => {
    const raw = stateFor();
    expect(verifyInstallState('garbage', SECRET)).toBeNull();
    expect(verifyInstallState('a.b.c', SECRET)).toBeNull();
    expect(verifyInstallState('', SECRET)).toBeNull();
    expect(verifyInstallState([raw, raw], SECRET)).toBeNull();
    expect(verifyInstallState({ toString: () => raw }, SECRET)).toBeNull();
    expect(verifyInstallState(undefined, SECRET)).toBeNull();
    expect(verifyInstallState('x'.repeat(5000), SECRET)).toBeNull();
  });
});

describe('verifyInstallTicket', () => {
  it('round-trips a ticket naming only the org', () => {
    const ticket = signInstallTicket({ orgId: 'org_1', exp: Date.now() + 60_000 }, SECRET);
    expect(verifyInstallTicket(ticket, SECRET)).toMatchObject({ orgId: 'org_1' });
  });

  it('rejects a callback state presented as a start ticket', () => {
    expect(verifyInstallTicket(stateFor(), SECRET)).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const ticket = signInstallTicket({ orgId: 'org_1', exp: Date.now() - 1 }, SECRET);
    expect(verifyInstallTicket(ticket, SECRET)).toBeNull();
  });
});
