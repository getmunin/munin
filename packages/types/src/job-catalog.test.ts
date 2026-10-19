import { describe, expect, it } from 'vitest';
import {
  KNOWN_SKILL_URIS,
  PAYLOAD_BOUND_ARGS_BY_URI,
  TOOLS_BY_URI,
  allowedToolsFor,
  jobKindOf,
  pinnedToolArgsFor,
  priorityFor,
  tierFor,
} from './job-catalog.ts';

describe('jobKindOf', () => {
  it('classifies skill:// URIs as skill', () => {
    expect(jobKindOf('skill://kb/review-content')).toBe('skill');
  });
  it('classifies task:// URIs as task', () => {
    expect(jobKindOf('task://web/scrape-website')).toBe('task');
  });
  it('returns null for anything else', () => {
    expect(jobKindOf('')).toBeNull();
    expect(jobKindOf('http://example.com')).toBeNull();
    expect(jobKindOf('not-a-uri')).toBeNull();
  });
});

describe('tierFor', () => {
  it('routes strip-email-signature to fast', () => {
    expect(tierFor('skill://conv/strip-email-signature')).toBe('fast');
  });
  it('defaults to smart', () => {
    expect(tierFor('skill://crm/clean-contact-data')).toBe('smart');
    expect(tierFor('task://web/scrape-website')).toBe('smart');
    expect(tierFor('skill://made-up/future')).toBe('smart');
    expect(tierFor('')).toBe('smart');
  });
});

describe('allowedToolsFor', () => {
  it('returns the configured tool allowlist for a known skill', () => {
    expect(allowedToolsFor('skill://kb/review-content')).toEqual([
      'conv_list_conversations',
      'conv_get_conversation',
      'kb_search',
      'kb_list_documents',
      'kb_get_document',
      'kb_list_curation_decisions',
      'kb_propose_curation_candidate',
      'kb_propose_curation_revision',
      'outreach_get_proposal',
    ]);
  });

  it('lets the curation pass read prior decisions its own skill requires', () => {
    expect(allowedToolsFor('skill://kb/review-content')).toContain('kb_list_curation_decisions');
  });
  it('returns undefined for unmapped URIs', () => {
    expect(allowedToolsFor('task://web/scrape-website')).toBeUndefined();
    expect(allowedToolsFor('skill://unknown/x')).toBeUndefined();
  });

  it('gives every known skill a non-empty allowlist so no skill job runs with the full admin surface', () => {
    const missing = [...KNOWN_SKILL_URIS].filter((uri) => (allowedToolsFor(uri)?.length ?? 0) === 0);
    expect(missing).toEqual([]);
  });

  it('only allowlists known skill URIs', () => {
    const unknown = [...TOOLS_BY_URI.keys()].filter((uri) => !KNOWN_SKILL_URIS.has(uri));
    expect(unknown).toEqual([]);
  });

  it('lists full snake_case tool names rather than prefixes', () => {
    const prefixLike = [...TOOLS_BY_URI.values()]
      .flat()
      .filter((name) => !/^[a-z]+(_[a-z0-9]+)+$/.test(name) || name.endsWith('_'));
    expect(prefixLike).toEqual([]);
  });
});

describe('pinnedToolArgsFor', () => {
  it('gives contact extraction only the conversation reader and the conversation-scoped writer', () => {
    expect(allowedToolsFor('skill://crm/extract-contact-from-message')).toEqual([
      'conv_get_conversation',
      'crm_apply_conversation_identity',
    ]);
  });

  it('pins contact extraction to the conversation named in its source event', () => {
    expect(
      pinnedToolArgsFor('skill://crm/extract-contact-from-message', {
        conversationId: 'ccv_1',
        status: 'closed',
      }),
    ).toEqual({
      ok: true,
      pinned: {
        conv_get_conversation: { id: 'ccv_1' },
        crm_apply_conversation_identity: { conversationId: 'ccv_1' },
      },
    });
  });

  it('pins signature stripping to the message named in its source event', () => {
    expect(
      pinnedToolArgsFor('skill://conv/strip-email-signature', {
        conversationId: 'ccv_1',
        messageId: 'ccm_1',
      }),
    ).toEqual({ ok: true, pinned: { conv_strip_message_signature: { messageId: 'ccm_1' } } });
  });

  it('reports the missing payload key instead of running a bound skill unpinned', () => {
    expect(pinnedToolArgsFor('skill://crm/extract-contact-from-message', null)).toEqual({
      ok: false,
      missing: 'conversationId',
    });
    expect(
      pinnedToolArgsFor('skill://conv/strip-email-signature', { conversationId: 'ccv_1', messageId: '' }),
    ).toEqual({ ok: false, missing: 'messageId' });
  });

  it('leaves unbound skills unpinned', () => {
    expect(pinnedToolArgsFor('skill://kb/review-content', { conversationId: 'ccv_1' })).toEqual({
      ok: true,
      pinned: undefined,
    });
  });

  it('only pins tools that the same skill is allowed to call', () => {
    const stray = [...PAYLOAD_BOUND_ARGS_BY_URI].flatMap(([uri, bindings]) =>
      Object.keys(bindings)
        .filter((tool) => !(allowedToolsFor(uri) ?? []).includes(tool))
        .map((tool) => `${uri} -> ${tool}`),
    );
    expect(stray).toEqual([]);
  });
});

describe('priorityFor', () => {
  it('prioritizes the interactive website import above background work', () => {
    expect(priorityFor('task://web/scrape-website')).toBe(100);
  });
  it('defaults background jobs to 0', () => {
    expect(priorityFor('skill://kb/review-content')).toBe(0);
    expect(priorityFor('skill://crm/clean-contact-data')).toBe(0);
    expect(priorityFor('skill://made-up/future')).toBe(0);
    expect(priorityFor('')).toBe(0);
  });
});

describe('KNOWN_SKILL_URIS', () => {
  it('only contains skill:// URIs', () => {
    for (const uri of KNOWN_SKILL_URIS) expect(uri.startsWith('skill://')).toBe(true);
  });
});
