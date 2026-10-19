import { describe, expect, it } from 'vitest';
import { ActorIdentity } from '@getmunin/core';
import { CONVERSATION_EVENT_TYPES, KNOWN_EVENT_TYPES } from '@getmunin/types';
import type { EventRow } from './db-listener.service.ts';
import {
  CUSTOMER_EVENT_FIELDS,
  MEMBER_EVENT_TYPES,
  eventForAccess,
  mayRelayOperatorTyping,
  memberMaySubscribe,
  projectEventForCustomer,
  realtimeAccessFor,
} from './realtime-access.ts';

function row(type: string, payload: Record<string, unknown>): EventRow {
  return {
    id: 'evt_1',
    org_id: 'org_1',
    type,
    actor_id: 'usr_operator',
    correlation_id: 'corr_1',
    hop_count: 0,
    payload,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function actor(
  type: ConstructorParameters<typeof ActorIdentity>[0],
  scopes: string[],
  audiences: ('admin' | 'self_service')[],
  endUserId?: string,
): ActorIdentity {
  return new ActorIdentity(type, 'id_1', 'org_1', scopes, audiences, endUserId);
}

describe('realtimeAccessFor mirrors the HTTP control-plane gate', () => {
  it('gives owners and admins the full org stream and members the restricted one', () => {
    const user = actor('user', ['*'], []);
    expect(realtimeAccessFor(user, 'owner')).toBe('staff');
    expect(realtimeAccessFor(user, 'admin')).toBe('staff');
    expect(realtimeAccessFor(user, 'member')).toBe('member');
    expect(realtimeAccessFor(user, null)).toBeNull();
  });

  it('admits an admin key only when it is unrestricted and carries the admin audience', () => {
    expect(realtimeAccessFor(actor('admin_agent', ['*'], ['admin']), null)).toBe('staff');
    expect(realtimeAccessFor(actor('admin_agent', ['kb:read'], ['admin']), null)).toBeNull();
    expect(realtimeAccessFor(actor('admin_agent', ['*'], ['self_service']), null)).toBeNull();
  });

  it('keeps end users on their own conversations and refuses actors with no realtime surface', () => {
    expect(realtimeAccessFor(actor('end_user_agent', ['conv:read'], ['self_service'], 'eu_1'), null)).toBe('end_user');
    expect(realtimeAccessFor(actor('end_user_agent', ['conv:read'], ['self_service']), null)).toBeNull();
    expect(realtimeAccessFor(actor('widget_agent', ['conv:widget:write'], ['self_service']), null)).toBeNull();
    expect(realtimeAccessFor(actor('partner', ['*'], ['admin']), null)).toBeNull();
    expect(realtimeAccessFor(actor('system', ['*'], ['admin']), null)).toBe('staff');
  });

  it('lets only staff and members relay operator typing', () => {
    expect(mayRelayOperatorTyping('staff')).toBe(true);
    expect(mayRelayOperatorTyping('member')).toBe(true);
    expect(mayRelayOperatorTyping('end_user')).toBe(false);
    expect(mayRelayOperatorTyping('widget')).toBe(false);
  });
});

describe('members see the inbox stream and nothing else', () => {
  it('allows the org and conversation channels only', () => {
    expect(memberMaySubscribe('org')).toBe(true);
    expect(memberMaySubscribe('conversation:cnv_1')).toBe(true);
    expect(memberMaySubscribe('contact:ctc_1')).toBe(false);
    expect(memberMaySubscribe('widget:cch_1:sess')).toBe(false);
  });

  it('is exactly the conversation event catalog', () => {
    expect([...MEMBER_EVENT_TYPES].sort()).toEqual([...CONVERSATION_EVENT_TYPES].sort());
  });

  it('drops admin-only events and passes conversation events through untouched', () => {
    for (const type of ['api_key.minted', 'crm.contact.created', 'end_user.created', 'kb.document.created', 'org_alert.opened']) {
      expect(eventForAccess('member', row(type, { conversationId: 'cnv_1' }))).toBeNull();
    }
    const event = row('conversation.draft_requested', { conversationId: 'cnv_1', note: 'be gentle' });
    expect(eventForAccess('member', event)).toBe(event);
    const minted = row('api_key.minted', {});
    expect(eventForAccess('staff', minted)).toBe(minted);
  });
});

describe('customer sockets get an allow-listed, projected event', () => {
  it('only ever allow-lists conversation events from the catalog', () => {
    for (const type of Object.keys(CUSTOMER_EVENT_FIELDS)) {
      expect(KNOWN_EVENT_TYPES as readonly string[]).toContain(type);
      expect(type.startsWith('conversation.')).toBe(true);
    }
  });

  it.each([
    ['conversation.draft_requested', { conversationId: 'cnv_1', note: 'offer a refund', requestedByUserId: 'usr_1' }],
    ['conversation.draft_ready', { conversationId: 'cnv_1', messageId: 'msg_draft' }],
    ['conversation.note_added', { conversationId: 'cnv_1', messageId: 'msg_note', authorType: 'user' }],
    ['conversation.agent_mode_changed', { conversationId: 'cnv_1', agentMode: 'off' }],
    ['conversation.translation_requested', { conversationId: 'cnv_1', targetLanguage: 'en' }],
    ['conversation.greet_requested', { conversationId: 'cnv_1', endUserId: 'eu_1' }],
    ['conversation.message.opened', { conversationId: 'cnv_1', messageId: 'msg_1' }],
    ['crm.activity.logged', { conversationId: 'cnv_1', contactId: 'ctc_1' }],
    ['outreach.proposal.created', { conversationId: 'cnv_1' }],
  ])('drops %s', (type, payload) => {
    expect(projectEventForCustomer(row(type, payload))).toBeNull();
    expect(eventForAccess('widget', row(type, payload))).toBeNull();
    expect(eventForAccess('end_user', row(type, payload))).toBeNull();
  });

  it('strips actor, correlation and staff-only payload fields', () => {
    const projected = projectEventForCustomer(
      row('conversation.handover_requested', {
        conversationId: 'cnv_1',
        reason: 'tool failed: connection refused',
      }),
    );
    expect(projected).toEqual({
      id: 'evt_1',
      type: 'conversation.handover_requested',
      payload: { conversationId: 'cnv_1' },
      created_at: '2026-01-01T00:00:00.000Z',
    });

    expect(
      projectEventForCustomer(
        row('conversation.taken_over', {
          conversationId: 'cnv_1',
          holderType: 'user',
          holderId: 'usr_1',
          expiresAt: '2026-01-01T00:05:00.000Z',
        }),
      )?.payload,
    ).toEqual({ conversationId: 'cnv_1' });

    expect(
      projectEventForCustomer(
        row('conversation.status_changed', { conversationId: 'cnv_1', status: 'closed' }),
      )?.payload,
    ).toEqual({ conversationId: 'cnv_1', status: 'closed' });
  });

  it('keeps the ids a client needs to refetch a new message', () => {
    expect(
      projectEventForCustomer(
        row('conversation.message.sent', {
          conversationId: 'cnv_1',
          messageId: 'msg_1',
          authorType: 'agent',
          internal: false,
        }),
      )?.payload,
    ).toEqual({ conversationId: 'cnv_1', messageId: 'msg_1', authorType: 'agent' });
  });

  it('drops internal messages and events with no conversation', () => {
    expect(
      projectEventForCustomer(
        row('conversation.message.body_revised', {
          conversationId: 'cnv_1',
          messageId: 'msg_1',
          internal: true,
          reason: 'signature_stripped',
        }),
      ),
    ).toBeNull();
    expect(projectEventForCustomer(row('conversation.created', {}))).toBeNull();
  });

  it('ignores inherited keys when matching the event type', () => {
    expect(projectEventForCustomer(row('constructor', { conversationId: 'cnv_1' }))).toBeNull();
    expect(projectEventForCustomer(row('__proto__', { conversationId: 'cnv_1' }))).toBeNull();
  });
});
