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

  it('admin_agent without admin in audiences → self_service', () => {
    expect(deriveMcpAudience(actor('admin_agent', ['self_service']))).toBe('self_service');
  });

  it('admin_agent with both audiences → admin', () => {
    expect(deriveMcpAudience(actor('admin_agent', ['admin', 'self_service']))).toBe('admin');
  });

  it('user with empty audiences → self_service', () => {
    expect(deriveMcpAudience(actor('user', []))).toBe('self_service');
  });

  it('partner actor is not admin-eligible even with admin audience', () => {
    expect(deriveMcpAudience(actor('partner', ['admin']))).toBe('self_service');
  });

  it('system actor is not admin-eligible even with admin audience', () => {
    expect(deriveMcpAudience(actor('system', ['admin']))).toBe('self_service');
  });
});
