import { describe, expect, it } from 'vitest';
import { ActorIdentity, buildAdminAgentActor, buildEndUserAgentActor } from '@getmunin/core';
import { PII_RAW_SCOPE } from '@getmunin/types';
import { decidePiiMode } from './pii-policy.ts';

const ORG = 'org_test';

function oauthConnector(scopes: string[]): ActorIdentity {
  return new ActorIdentity('user', 'usr_1', ORG, scopes, ['admin'], undefined, 'oat_1', undefined, 'usr_1', 'client_1');
}

function apiKey(scopes: string[]): ActorIdentity {
  return new ActorIdentity('admin_agent', 'tok_0123456789abcdefghijkl', ORG, scopes, ['admin']);
}

describe('decidePiiMode', () => {
  it('gives the in-house runner raw data, admin and end-user alike', () => {
    expect(decidePiiMode(buildAdminAgentActor(ORG), 'admin')).toEqual({ mode: 'raw', reason: 'in_house_agent' });
    expect(
      decidePiiMode(buildEndUserAgentActor({ orgId: ORG, endUserId: 'eu_1' }), 'self_service'),
    ).toEqual({ mode: 'raw', reason: 'in_house_agent' });
  });

  it('keeps the runner raw even when the org requires pseudonymization', () => {
    expect(decidePiiMode(buildAdminAgentActor(ORG), 'admin', { externalRaw: 'forbid' }).mode).toBe('raw');
  });

  it('pseudonymizes an OAuth connector unless it was granted the raw scope', () => {
    expect(decidePiiMode(oauthConnector(['mcp:admin', 'conv:read']), 'admin')).toEqual({
      mode: 'pseudonymized',
      reason: 'default',
    });
    expect(decidePiiMode(oauthConnector(['mcp:admin', PII_RAW_SCOPE]), 'admin')).toEqual({
      mode: 'raw',
      reason: 'raw_scope',
    });
  });

  it('treats a wildcard API key as holding the raw scope, and a narrowed one as not', () => {
    expect(decidePiiMode(apiKey(['*']), 'admin').mode).toBe('raw');
    expect(decidePiiMode(apiKey(['conv:read', 'crm:read']), 'admin').mode).toBe('pseudonymized');
  });

  it('lets the org floor override any raw scope an external caller holds', () => {
    expect(decidePiiMode(apiKey(['*']), 'admin', { externalRaw: 'forbid' })).toEqual({
      mode: 'pseudonymized',
      reason: 'org_requires_pseudonymization',
    });
    expect(decidePiiMode(oauthConnector([PII_RAW_SCOPE]), 'admin', { externalRaw: 'forbid' }).mode).toBe(
      'pseudonymized',
    );
  });

  it('leaves self-service results raw, because the caller is the data subject', () => {
    const widget = new ActorIdentity('widget_agent', 'key_1', ORG, [], ['self_service']);
    expect(decidePiiMode(widget, 'self_service')).toEqual({ mode: 'raw', reason: 'self_service' });
  });

  it('does not mistake an id that merely contains the runner prefix for the runner', () => {
    const lookalike = new ActorIdentity('admin_agent', 'tok_agent-host:org_test', ORG, ['conv:read'], ['admin']);
    expect(decidePiiMode(lookalike, 'admin').mode).toBe('pseudonymized');
  });
});
