import { describe, expect, it } from 'vitest';
import {
  countReviewDecisions,
  groupReviewQueue,
  isViewerLanguage,
  nextAfterDecision,
  nextAfterDecisions,
  nextWaitingSibling,
  partitionReviewQueue,
  pickLeadTranslation,
  resolveReviewFirstRun,
  reviewEntryIds,
} from './review-queue';
import type { CmsEntryStatus, CmsTranslationDto, QueueItem } from './queue-panes/types';

function item(kind: QueueItem['kind'], id: string, createdAt: string): QueueItem {
  return { kind, id, title: id, snippet: '', createdAt, raw: {} } as QueueItem;
}

describe('partitionReviewQueue', () => {
  it('routes knowledge proposals to improvements and every other kind to blocking', () => {
    const { blocking, improvements } = partitionReviewQueue([
      item('kb', 'kb', '2026-09-02T10:00:00.000Z'),
      item('cms', 'cms', '2026-09-02T10:00:00.000Z'),
      item('crm', 'crm', '2026-09-02T10:00:00.000Z'),
      item('outreach', 'outreach', '2026-09-02T10:00:00.000Z'),
    ]);
    expect(improvements.map((i) => i.id)).toEqual(['kb']);
    expect(blocking.map((i) => i.id).sort()).toEqual(['cms', 'crm', 'outreach']);
  });

  it('puts feedback awaiting approval in blocking — someone is waiting on that decision', () => {
    const { blocking } = partitionReviewQueue([
      item('feedback', 'fbk', '2026-09-02T10:00:00.000Z'),
    ]);
    expect(blocking.map((i) => i.id)).toEqual(['fbk']);
  });

  it('sorts blocking oldest first so the longest wait surfaces at the top', () => {
    const { blocking } = partitionReviewQueue([
      item('cms', 'new', '2026-09-02T10:00:00.000Z'),
      item('outreach', 'old', '2026-08-28T10:00:00.000Z'),
      item('crm', 'mid', '2026-09-01T10:00:00.000Z'),
    ]);
    expect(blocking.map((i) => i.id)).toEqual(['old', 'mid', 'new']);
  });

  it('sorts improvements newest first — they carry no deadline', () => {
    const { improvements } = partitionReviewQueue([
      item('kb', 'old', '2026-08-28T10:00:00.000Z'),
      item('kb', 'new', '2026-09-02T10:00:00.000Z'),
    ]);
    expect(improvements.map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('keeps an unparseable timestamp in the list instead of dropping the item', () => {
    const { blocking } = partitionReviewQueue([
      item('cms', 'dated', '2026-09-02T10:00:00.000Z'),
      item('cms', 'broken', 'not-a-date'),
    ]);
    expect(blocking.map((i) => i.id)).toEqual(['broken', 'dated']);
  });

  it('leaves the source array untouched', () => {
    const queue = [
      item('cms', 'a', '2026-09-02T10:00:00.000Z'),
      item('cms', 'b', '2026-08-28T10:00:00.000Z'),
    ];
    partitionReviewQueue(queue);
    expect(queue.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('resolveReviewFirstRun', () => {
  const now = new Date('2026-09-08T10:00:00.000Z').getTime();
  const unloaded = { loaded: false, empty: false };

  it('answers from the setup snapshot before the lists land, so no skeleton precedes first run', () => {
    const setupQueue = { hasPendingItems: false, lastDecisionAt: null };
    expect(resolveReviewFirstRun(setupQueue, unloaded, now)).toBe(true);
  });

  it('waits for the lists when the snapshot predates them', () => {
    expect(resolveReviewFirstRun(null, unloaded, now)).toBeNull();
  });

  it('waits for the lists when the snapshot reports work waiting', () => {
    const setupQueue = { hasPendingItems: true, lastDecisionAt: null };
    expect(resolveReviewFirstRun(setupQueue, unloaded, now)).toBeNull();
  });

  it('waits for the lists when a decision still falls inside the decided window', () => {
    const setupQueue = { hasPendingItems: false, lastDecisionAt: '2026-09-01T10:00:00.000Z' };
    expect(resolveReviewFirstRun(setupQueue, unloaded, now)).toBeNull();
  });

  it('ignores a decision that has aged out of the decided window', () => {
    const setupQueue = { hasPendingItems: false, lastDecisionAt: '2026-01-01T10:00:00.000Z' };
    expect(resolveReviewFirstRun(setupQueue, unloaded, now)).toBe(true);
  });

  it('lets the loaded lists overrule a snapshot that has gone stale', () => {
    const setupQueue = { hasPendingItems: false, lastDecisionAt: null };
    expect(resolveReviewFirstRun(setupQueue, { loaded: true, empty: false }, now)).toBe(false);
    expect(resolveReviewFirstRun(setupQueue, { loaded: true, empty: true }, now)).toBe(true);
  });
});

describe('nextAfterDecision', () => {
  it('opens the item that was below the decided one', () => {
    expect(nextAfterDecision(['a', 'b', 'c'], 'b')).toBe('c');
  });

  it('falls back to the item above when the decided one was last', () => {
    expect(nextAfterDecision(['a', 'b', 'c'], 'c')).toBe('b');
  });

  it('returns null when the decided item was the only one waiting', () => {
    expect(nextAfterDecision(['a'], 'a')).toBeNull();
  });

  it('returns null when the decided item is not in the list it was decided from', () => {
    expect(nextAfterDecision(['a', 'b'], 'z')).toBeNull();
  });
});

function translation(
  locale: string,
  status: CmsEntryStatus = 'draft',
  isDefaultLocale = false,
): CmsTranslationDto {
  return { id: `cme_${locale}`, locale, status, version: 1, title: `Title ${locale}`, isDefaultLocale };
}

function translated(
  groupId: string,
  translations: CmsTranslationDto[],
  createdAt = '2026-09-02T10:00:00.000Z',
): QueueItem[] {
  return translations
    .filter((t) => t.status === 'draft')
    .map((t) => ({
      kind: 'cms',
      id: `${groupId}_${t.locale}`,
      title: t.title,
      snippet: '',
      createdAt,
      raw: {
        id: `${groupId}_${t.locale}`,
        collectionId: 'cmc_1',
        collectionSlug: 'changelog',
        collectionName: 'Changelog',
        slug: t.locale,
        locale: t.locale,
        translationGroupId: groupId,
        translations: translations.map((s) => ({ ...s, id: `${groupId}_${s.locale}` })),
        title: t.title,
        titleFieldName: 'title',
        wordCount: 10,
        version: 1,
        updatedAt: createdAt,
      },
    }));
}

describe('pickLeadTranslation', () => {
  it('leads with the reviewer language, matching nb against no and regional codes', () => {
    expect(pickLeadTranslation([translation('en'), translation('nb')], 'nb')?.locale).toBe('nb');
    expect(pickLeadTranslation([translation('en'), translation('no')], 'nb')?.locale).toBe('no');
    expect(pickLeadTranslation([translation('sv'), translation('en-GB')], 'en')?.locale).toBe('en-GB');
  });

  it('prefers an exact locale over a regional variant of the same language', () => {
    expect(pickLeadTranslation([translation('en-GB'), translation('en')], 'en')?.locale).toBe('en');
  });

  it('falls back to the default locale, then to the oldest entry', () => {
    expect(
      pickLeadTranslation([translation('sv'), translation('da', 'draft', true)], 'nb')?.locale,
    ).toBe('da');
    expect(pickLeadTranslation([translation('sv'), translation('da')], 'nb')?.locale).toBe('sv');
    expect(pickLeadTranslation([], 'nb')).toBeNull();
  });

  it('does not treat nynorsk or Swedish as the reviewer language of a bokmål dashboard', () => {
    expect(isViewerLanguage('nn', 'nb')).toBe(false);
    expect(isViewerLanguage('sv', 'nb')).toBe(false);
    expect(isViewerLanguage('nb-NO', 'nb')).toBe(true);
  });
});

describe('groupReviewQueue', () => {
  const four = [translation('en'), translation('nb'), translation('sv'), translation('da')];

  it('folds the locales of one entry into a single list entry with the reviewer language first', () => {
    const entries = groupReviewQueue(
      [...translated('g1', four), item('crm', 'crm', '2026-09-02T10:00:00.000Z')],
      'nb',
    );
    expect(entries.map((e) => e.type)).toEqual(['group', 'single']);
    const [first] = entries;
    if (first?.type !== 'group') throw new Error('expected a group');
    expect(first.group.lead.locale).toBe('nb');
    expect(first.group.leadIsViewerLanguage).toBe(true);
    expect(first.group.translations.map((t) => t.locale)).toEqual(['nb', 'en', 'sv', 'da']);
    expect(first.group.members.map((m) => m.id)).toEqual(['g1_nb', 'g1_en', 'g1_sv', 'g1_da']);
  });

  it('keeps a published sibling as context without making it a member to decide', () => {
    const [entry] = groupReviewQueue(
      translated('g1', [translation('nb', 'published'), translation('en'), translation('sv')]),
      'nb',
    );
    if (entry?.type !== 'group') throw new Error('expected a group');
    expect(entry.group.lead).toMatchObject({ locale: 'nb', status: 'published' });
    expect(entry.group.members.map((m) => m.id)).toEqual(['g1_en', 'g1_sv']);
  });

  it('groups a lone draft whose siblings are all live, so it can be compared with one of them', () => {
    const [entry] = groupReviewQueue(
      translated('g1', [translation('nb', 'published'), translation('sv')]),
      'nb',
    );
    expect(entry?.type).toBe('group');
  });

  it('leaves an entry with no other locale as a plain row', () => {
    const entries = groupReviewQueue(translated('g1', [translation('nb')]), 'nb');
    expect(entries.map((e) => e.type)).toEqual(['single']);
    expect(reviewEntryIds(entries)).toEqual(['g1_nb']);
  });

  it('places a group where its first waiting locale sat and keeps the other rows in order', () => {
    const [nb, en] = translated('g1', [translation('nb'), translation('en')]);
    const entries = groupReviewQueue(
      [item('crm', 'before', ''), nb!, item('outreach', 'between', ''), en!, item('crm', 'after', '')],
      'nb',
    );
    expect(reviewEntryIds(entries)).toEqual(['before', 'g1_nb', 'g1_en', 'between', 'after']);
  });
});

describe('countReviewDecisions', () => {
  it('counts a translation group once and every other item once', () => {
    const queue = [
      ...translated('g1', [translation('nb'), translation('en'), translation('sv')]),
      ...translated('g2', [translation('nb', 'published'), translation('en')]),
      ...translated('g3', [translation('nb')]),
      item('crm', 'crm', ''),
      item('kb', 'kb', ''),
    ];
    expect(queue).toHaveLength(7);
    expect(countReviewDecisions(queue)).toBe(5);
  });
});

describe('nextAfterDecisions', () => {
  const ids = ['a', 'g_nb', 'g_en', 'g_sv', 'b'];

  it('moves past the whole group to the next item', () => {
    expect(nextAfterDecisions(ids, ['g_nb', 'g_en', 'g_sv'])).toBe('b');
  });

  it('steps back to the item before the group when the group was last', () => {
    expect(nextAfterDecisions(['a', 'g_nb', 'g_en'], ['g_nb', 'g_en'])).toBe('a');
  });

  it('returns null when the group was the whole queue or is no longer listed', () => {
    expect(nextAfterDecisions(['g_nb', 'g_en'], ['g_nb', 'g_en'])).toBeNull();
    expect(nextAfterDecisions(ids, ['gone'])).toBeNull();
  });

  it('agrees with nextAfterDecision for a single decided item', () => {
    for (const id of ids) {
      expect(nextAfterDecisions(ids, [id])).toBe(nextAfterDecision(ids, id));
    }
  });
});

describe('nextWaitingSibling', () => {
  it('advances to the next waiting locale and wraps to the first after the last', () => {
    expect(nextWaitingSibling(['nb', 'en', 'sv'], 'en')).toBe('sv');
    expect(nextWaitingSibling(['nb', 'en', 'sv'], 'sv')).toBe('nb');
  });

  it('returns null when no other locale is waiting', () => {
    expect(nextWaitingSibling(['nb'], 'nb')).toBeNull();
    expect(nextWaitingSibling(['nb', 'en'], 'missing')).toBeNull();
  });
});
