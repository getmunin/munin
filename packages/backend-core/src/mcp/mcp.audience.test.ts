import { describe, it, expect } from 'vitest';
import { ActorIdentity, type ActorType, type Audience } from '@getmunin/core';
import { deriveMcpAudience } from './mcp.audience.ts';

function actor(type: ActorType, audiences: Audience[]): ActorIdentity {
  return new ActorIdentity(type, 'actor_test', 'org_test', ['*'], audiences);
}

describe('deriveMcpAudience', () => {
  it('admin_agent with admin audience → admin', () => {
    expect(deriveMcpAudience(actor('admin_agent', ['admin']))).toBe('admin');
  });

  it('OAuth user with admin audience → admin (claude.ai connector flow)', () => {
    expect(deriveMcpAudience(actor('user', ['admin']))).toBe('admin');
  });

  it('end_user_agent with admin audience is clamped to self_service (defense-in-depth)', () => {
    expect(deriveMcpAudience(actor('end_user_agent', ['admin']))).toBe('self_service');
  });

  it('widget_agent with admin audience is clamped to self_service (defense-in-depth)', () => {
    expect(deriveMcpAudience(actor('widget_agent', ['admin']))).toBe('self_service');
  });

  it('admin_agent without admin in audiences → self_service (a key minted self-service on purpose)', () => {
    expect(deriveMcpAudience(actor('admin_agent', ['self_service']))).toBe('self_service');
  });

  it('admin_agent with both audiences → admin', () => {
    expect(deriveMcpAudience(actor('admin_agent', ['admin', 'self_service']))).toBe('admin');
  });

  it('partner actor is not admin-eligible even with admin audience', () => {
    expect(deriveMcpAudience(actor('partner', ['admin']))).toBe('self_service');
  });

  it('system actor is not admin-eligible even with admin audience', () => {
    expect(deriveMcpAudience(actor('system', ['admin']))).toBe('self_service');
  });
});

describe('a human whose role did not earn the admin audience is denied, never demoted', () => {
  it('a member reaches empty audiences because gateOauthGrantsByRole stripped mcp:admin, and gets no MCP surface at all', () => {
    expect(deriveMcpAudience(actor('user', []))).toBeNull();
  });

  it('the self_service surface is for end-user agents, so a user actor never lands on it', () => {
    expect(deriveMcpAudience(actor('user', ['self_service']))).toBeNull();
  });
});

describe('the MCP audience matrix is a closed list, because RLS narrows self_service by app.end_user_id and a user actor sets none', () => {
  const EXPECTED: Array<[ActorType, Audience[], Audience | null]> = [
    ['admin_agent', ['admin'], 'admin'],
    ['admin_agent', ['self_service'], 'self_service'],
    ['admin_agent', [], 'self_service'],
    ['user', ['admin'], 'admin'],
    ['user', ['self_service'], null],
    ['user', [], null],
    ['widget_agent', ['admin'], 'self_service'],
    ['widget_agent', ['self_service'], 'self_service'],
    ['widget_agent', [], 'self_service'],
    ['end_user_agent', ['admin'], 'self_service'],
    ['end_user_agent', ['self_service'], 'self_service'],
    ['end_user_agent', [], 'self_service'],
    ['partner', ['admin'], 'self_service'],
    ['partner', ['self_service'], 'self_service'],
    ['partner', [], 'self_service'],
    ['system', ['admin'], 'self_service'],
    ['system', ['self_service'], 'self_service'],
    ['system', [], 'self_service'],
  ];

  it('widening the surface has to be a deliberate diff here', () => {
    const actual = EXPECTED.map(([type, audiences]) => [
      type,
      audiences,
      deriveMcpAudience(actor(type, audiences)),
    ]);
    expect(actual).toEqual(EXPECTED);
  });
});
