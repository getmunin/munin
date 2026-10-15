import { describe, expect, it } from 'vitest';
import { pickUnsubscribeLocale, renderUnsubscribePage } from './outreach-unsubscribe.page.ts';

describe('pickUnsubscribeLocale', () => {
  it('serves Norwegian for any Norwegian written standard', () => {
    expect(pickUnsubscribeLocale('nb-NO,nb;q=0.9,en;q=0.8')).toBe('nb');
    expect(pickUnsubscribeLocale('no')).toBe('nb');
    expect(pickUnsubscribeLocale('nn-NO')).toBe('nb');
  });

  it('follows quality weights rather than header order', () => {
    expect(pickUnsubscribeLocale('en;q=0.5,nb;q=0.9')).toBe('nb');
    expect(pickUnsubscribeLocale('nb;q=0.4,en')).toBe('en');
  });

  it('falls back to English for missing or unsupported languages', () => {
    expect(pickUnsubscribeLocale(undefined)).toBe('en');
    expect(pickUnsubscribeLocale('de-DE,fr;q=0.8')).toBe('en');
    expect(pickUnsubscribeLocale('nb;q=0')).toBe('en');
  });
});

describe('renderUnsubscribePage', () => {
  it('asks for confirmation with a form that posts the token back, so a link scanner opening the page unsubscribes nobody', () => {
    const html = renderUnsubscribePage({
      view: 'subscribed',
      locale: 'en',
      orgName: 'Acme',
      token: 'v1.org_a.cct_b.cmp_c.1.sig+/=',
    });
    expect(html).toContain('Unsubscribe from Acme?');
    expect(html).toContain('<form method="post" action="?token=v1.org_a.cct_b.cmp_c.1.sig%2B%2F%3D">');
    expect(html).not.toMatch(/<script/i);
  });

  it('renders no form once the person is unsubscribed', () => {
    for (const view of ['done', 'unsubscribed', 'not_found', 'invalid'] as const) {
      const html = renderUnsubscribePage({ view, locale: 'en', orgName: 'Acme', token: 'tok' });
      expect(html, view).not.toContain('<form');
    }
  });

  it('escapes the organization name', () => {
    const html = renderUnsubscribePage({
      view: 'subscribed',
      locale: 'en',
      orgName: '<img src=x onerror=alert(1)>',
      token: 'tok',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('names the sender generically when the organization is unknown', () => {
    const html = renderUnsubscribePage({ view: 'done', locale: 'nb', orgName: null, token: null });
    expect(html).toContain('<html lang="nb">');
    expect(html).toContain('Du er meldt av');
    expect(html).toContain('Avsenderen sender deg ikke flere e-poster som denne.');
  });
});
