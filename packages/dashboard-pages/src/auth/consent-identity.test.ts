import { describe, expect, it } from 'vitest';
import { redirectHostOf, resolveConsentIdentity } from './consent-identity';

const base = {
  clientId: 'client_abc',
  clientName: 'Acme Agent',
  impersonates: null,
  registeredRedirectHost: 'acme.example',
  requestedRedirectUri: 'https://acme.example/oauth/callback',
};

describe('resolveConsentIdentity', () => {
  it('shows the registered name and icon for a client that impersonates nobody', () => {
    expect(resolveConsentIdentity(base)).toEqual({
      displayName: 'Acme Agent',
      redirectHost: 'acme.example',
      showClientIcon: true,
      impersonates: null,
    });
  });

  it('names the host from the signed request, which is where the code is actually sent', () => {
    const identity = resolveConsentIdentity({
      ...base,
      registeredRedirectHost: 'acme.example',
      requestedRedirectUri: 'https://second.acme.example/cb',
    });
    expect(identity.redirectHost).toBe('second.acme.example');
  });

  it('falls back to the registered redirect host when the request carries none', () => {
    expect(resolveConsentIdentity({ ...base, requestedRedirectUri: null }).redirectHost).toBe(
      'acme.example',
    );
    expect(
      resolveConsentIdentity({ ...base, requestedRedirectUri: 'not a url' }).redirectHost,
    ).toBe('acme.example');
  });

  it('replaces an impersonated name and icon with the redirect host', () => {
    expect(
      resolveConsentIdentity({
        ...base,
        clientName: 'Claude',
        impersonates: 'Claude',
        registeredRedirectHost: 'attacker.example',
        requestedRedirectUri: 'https://attacker.example/cb',
      }),
    ).toEqual({
      displayName: 'attacker.example',
      redirectHost: 'attacker.example',
      showClientIcon: false,
      impersonates: 'Claude',
    });
  });

  it('falls back to the client id when an impersonating client has no redirect host', () => {
    const identity = resolveConsentIdentity({
      ...base,
      clientName: 'Claude',
      impersonates: 'Claude',
      registeredRedirectHost: null,
      requestedRedirectUri: null,
    });
    expect(identity.displayName).toBe('client_abc');
    expect(identity.showClientIcon).toBe(false);
  });

  it('uses the client id when the client registered no name', () => {
    expect(resolveConsentIdentity({ ...base, clientName: '  ' }).displayName).toBe('client_abc');
    expect(resolveConsentIdentity({ ...base, clientName: null }).displayName).toBe('client_abc');
  });

  it('treats a missing impersonation field from an older server as no impersonation', () => {
    expect(resolveConsentIdentity({ ...base, impersonates: undefined }).showClientIcon).toBe(true);
  });
});

describe('redirectHostOf', () => {
  it('returns the hostname of a redirect uri', () => {
    expect(redirectHostOf('http://localhost:33418/callback')).toBe('localhost');
    expect(redirectHostOf('https://acme.example/cb')).toBe('acme.example');
  });

  it('returns null for missing or unparseable input', () => {
    expect(redirectHostOf(null)).toBeNull();
    expect(redirectHostOf('')).toBeNull();
    expect(redirectHostOf('not a url')).toBeNull();
  });
});
