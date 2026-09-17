import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import nb from '../../messages/nb.json';
import { queueCodeKey } from './queue-panes/types';
import type { QueueItem } from './queue-panes/types';

const KINDS: QueueItem['kind'][] = ['kb', 'crm', 'outreach', 'cms', 'feedback', 'social'];

const NAMESPACES: Array<{
  path: string;
  codes: (messages: typeof en) => Record<string, unknown>;
}> = [
  { path: 'dashboard.console.review', codes: (m) => m.dashboard.console.review },
  { path: 'dashboard.overview.queue', codes: (m) => m.dashboard.overview.queue },
];

describe('queue code keys', () => {
  for (const [locale, messages] of [
    ['en', en],
    ['nb', nb],
  ] as const) {
    for (const ns of NAMESPACES) {
      it(`resolves a code for every queue kind in ${ns.path} (${locale})`, () => {
        const codes = ns.codes(messages);
        const missing = KINDS.filter((kind) => typeof codes[queueCodeKey(kind)] !== 'string');
        expect(missing).toEqual([]);
      });
    }
  }

  it('gives a kind the same code wherever it is listed, so one item reads alike everywhere', () => {
    for (const [locale, messages] of [
      ['en', en],
      ['nb', nb],
    ] as const) {
      for (const kind of KINDS) {
        const key = queueCodeKey(kind);
        expect(
          messages.dashboard.console.review[key as keyof typeof messages.dashboard.console.review],
          `${locale}: ${kind}`,
        ).toBe(messages.dashboard.overview.queue[key as keyof typeof messages.dashboard.overview.queue]);
      }
    }
  });
});
