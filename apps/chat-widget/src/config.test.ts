import { describe, it, expect, beforeEach } from 'vitest';
import { parseConfig } from './config.js';

function makeScript(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.body.appendChild(el);
  return el;
}

describe('parseConfig', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('parses a minimal valid config and applies defaults', () => {
    const el = makeScript({
      'data-munin-host': 'https://munin.example.com/',
      'data-widget-key': 'mn_widget_abc',
      'data-channel-id': 'cnv_001',
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      host: 'https://munin.example.com', // trailing slash stripped
      widgetKey: 'mn_widget_abc',
      channelId: 'cnv_001',
      themeColor: '#0066FF',
      position: 'bottom-right',
      greeting: null,
      title: null,
      eyebrow: null,
      locale: null,
      size: 'standard',
      fonts: 'bundled',
      showHistory: true,
    });
    expect(result.config.visitor).toBeUndefined();
    expect(result.config.externalId).toBeUndefined();
    expect(result.config.userHash).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('reports each missing required attribute', () => {
    const el = makeScript({});
    const result = parseConfig(el);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const attrs = result.errors.map((e) => e.attr).sort();
    expect(attrs).toEqual(['data-channel-id', 'data-munin-host', 'data-widget-key']);
  });

  it('treats blank required attrs as missing', () => {
    const el = makeScript({
      'data-munin-host': '   ',
      'data-widget-key': '',
      'data-channel-id': 'cnv_001',
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const attrs = result.errors.map((e) => e.attr).sort();
    expect(attrs).toEqual(['data-munin-host', 'data-widget-key']);
  });

  it('accepts a valid (externalId, userHash) pair', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-external-id': 'user_42',
      'data-user-hash': 'a'.repeat(64),
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.externalId).toBe('user_42');
    expect(result.config.userHash).toBe('a'.repeat(64));
  });

  it('rejects a partial identity pair (externalId without userHash, and vice versa)', () => {
    const e1 = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-external-id': 'user_42',
    });
    const r1 = parseConfig(e1);
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.errors.some((e) => e.attr.includes('data-external-id'))).toBe(true);

    document.body.innerHTML = '';
    const e2 = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-user-hash': 'a'.repeat(64),
    });
    const r2 = parseConfig(e2);
    expect(r2.ok).toBe(false);
  });

  it('rejects a userHash that is not 64 hex chars', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-external-id': 'user_42',
      'data-user-hash': 'not-hex',
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.attr === 'data-user-hash')).toBe(true);
  });

  it('demotes a malformed theme color to a warning and falls back to default', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-theme-color': 'periwinkle',
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.themeColor).toBe('#0066FF');
    expect(result.warnings.some((w) => w.attr === 'data-munin-theme-color')).toBe(true);
  });

  it('demotes invalid position to default with warning', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-position': 'inline',
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.position).toBe('bottom-right');
    expect(result.warnings.some((w) => w.attr === 'data-munin-position')).toBe(true);
  });

  it('parses visitor name + valid email; drops invalid email with warning', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-visitor-name': 'Ada Lovelace',
      'data-munin-visitor-email': 'not-an-email',
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.visitor?.name).toBe('Ada Lovelace');
    expect(result.config.visitor?.email).toBeUndefined();
    expect(result.warnings.some((w) => w.attr === 'data-munin-visitor-email')).toBe(true);
  });

  it('parses sugar-form metadata: data-munin-meta-<key>="<value>"', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-meta-plan': 'pro',
      'data-munin-meta-account-id': 'acc_42',
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.visitor?.metadata).toEqual({ plan: 'pro', accountId: 'acc_42' });
  });

  it('parses explicit JSON metadata; explicit wins on key collision', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-meta-plan': 'free', // sugar
      'data-munin-visitor-meta': JSON.stringify({ plan: 'pro', tier: 5, beta: true }), // explicit
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.visitor?.metadata).toEqual({ plan: 'pro', tier: 5, beta: true });
  });

  it('drops malformed JSON metadata with a warning, keeps the rest of the config', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-visitor-meta': '{not json',
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.visitor?.metadata).toBeUndefined();
    expect(result.warnings.some((w) => w.attr === 'data-munin-visitor-meta')).toBe(true);
  });

  it('rejects oversized visitor-meta JSON with a warning', () => {
    const big = JSON.stringify({ pad: 'x'.repeat(5000) });
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-visitor-meta': big,
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.visitor?.metadata).toBeUndefined();
    expect(result.warnings.some((w) => w.attr === 'data-munin-visitor-meta')).toBe(true);
  });

  it('drops non-primitive metadata values with a warning', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-visitor-meta': JSON.stringify({ plan: 'pro', tags: ['a', 'b'] }),
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.visitor?.metadata).toEqual({ plan: 'pro' });
    expect(result.warnings.some((w) => w.attr === 'data-munin-visitor-meta')).toBe(true);
  });

  it('rejects a non-object JSON metadata payload', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-visitor-meta': '"just-a-string"',
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.visitor?.metadata).toBeUndefined();
    expect(result.warnings.some((w) => w.attr === 'data-munin-visitor-meta')).toBe(true);
  });

  it('truncates visitor name to 120 chars to match the BE schema', () => {
    const el = makeScript({
      'data-munin-host': 'https://h.example',
      'data-widget-key': 'mn_widget_x',
      'data-channel-id': 'c',
      'data-munin-visitor-name': 'x'.repeat(200),
    });
    const result = parseConfig(el);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.visitor?.name).toHaveLength(120);
  });
});
