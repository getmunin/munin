import { describe, it, expect } from 'vitest';
import { readSignedState, signSignedState } from './signed-state.ts';

const SECRET = 'state-secret-for-tests';
const OTHER_SECRET = 'a-different-secret';

function future(): number {
  return Date.now() + 60_000;
}

describe('signed state', () => {
  it('round-trips the payload it was given', () => {
    const signed = signSignedState({ connectionId: 'cnn_1', orgId: 'org_1', exp: future() }, SECRET);
    const state = readSignedState(signed, SECRET);
    expect(state?.['connectionId']).toBe('cnn_1');
    expect(state?.['orgId']).toBe('org_1');
  });

  it('refuses a payload edited after signing', () => {
    const signed = signSignedState({ orgId: 'org_1', exp: future() }, SECRET);
    const [payload, signature] = signed.split('.');
    const tampered = Buffer.from(
      JSON.stringify({ orgId: 'org_attacker', exp: future() }),
    ).toString('base64url');
    expect(payload).not.toBe(tampered);
    expect(readSignedState(`${tampered}.${signature!}`, SECRET)).toBeNull();
  });

  it('refuses a state signed with another secret', () => {
    const signed = signSignedState({ orgId: 'org_1', exp: future() }, OTHER_SECRET);
    expect(readSignedState(signed, SECRET)).toBeNull();
  });

  it('refuses a state whose window has closed', () => {
    const signed = signSignedState({ orgId: 'org_1', exp: Date.now() - 1 }, SECRET);
    expect(readSignedState(signed, SECRET)).toBeNull();
  });

  it('refuses a state that never carried an expiry', () => {
    const signed = signSignedState({ orgId: 'org_1' }, SECRET);
    expect(readSignedState(signed, SECRET)).toBeNull();
  });

  it('refuses input that is not a signed state at all', () => {
    expect(readSignedState(undefined, SECRET)).toBeNull();
    expect(readSignedState('', SECRET)).toBeNull();
    expect(readSignedState('nodot', SECRET)).toBeNull();
    expect(readSignedState('.sig', SECRET)).toBeNull();
    expect(readSignedState(42, SECRET)).toBeNull();
  });

  it('refuses an oversized state instead of parsing it', () => {
    expect(readSignedState(`${'a'.repeat(5000)}.sig`, SECRET)).toBeNull();
  });

  it('refuses a payload that decodes to an array rather than an object', () => {
    const signed = signSignedState([1, 2, 3], SECRET);
    expect(readSignedState(signed, SECRET)).toBeNull();
  });
});
