import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, type UiController, type UploadedAttachment } from './ui.ts';
import type { ListedAttachment, ListedMessage } from './api.ts';
import type { WidgetConfig } from './config.ts';
import strings from './strings/en.ts';

const baseConfig: WidgetConfig = {
  host: 'https://munin.example',
  widgetKey: 'mn_widget_abc',
  channelId: 'cnv_chan',
  themeColor: '#10b981',
  position: 'bottom-right',
  greeting: null,
  title: null,
  eyebrow: null,
  locale: 'en',
  size: 'standard',
  fonts: 'inherit',
  corners: 'square',
  colorScheme: 'auto',
  showHistory: true,
};

let controller: UiController | null = null;

afterEach(() => {
  controller?.destroy();
  controller = null;
  document.body.innerHTML = '';
});

function shadowRoot(): ShadowRoot {
  const host = document.querySelector('[data-munin-widget]');
  if (!host) throw new Error('widget host not mounted');
  const sr = (host as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
  if (!sr) throw new Error('expected open shadowRoot');
  return sr;
}

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = shadowRoot().querySelector(selector);
  if (!el) throw new Error(`no element matched ${selector}`);
  return el as T;
}

function $$(selector: string): Element[] {
  return Array.from(shadowRoot().querySelectorAll(selector));
}

function attachment(partial: Partial<ListedAttachment> = {}): ListedAttachment {
  return {
    id: 'att_1',
    name: 'shot.png',
    mime: 'image/png',
    sizeBytes: 4096,
    width: 320,
    height: 240,
    url: 'https://munin.example/v1/c/a/tok',
    thumbnailUrl: 'https://munin.example/v1/c/a/tok?w=320',
    deleted: false,
    ...partial,
  };
}

function msg(partial: Partial<ListedMessage> & { id: string; role: ListedMessage['role']; body: string }): ListedMessage {
  return {
    authorKind: partial.role === 'agent' ? 'ai' : null,
    authorName: partial.role === 'agent' ? 'Munin' : null,
    bodyHtml: null,
    at: '2026-01-01T00:00:00Z',
    readAt: null,
    ...partial,
  };
}

function pngFile(name = 'pic.png', bytes = 64): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

function mountChat(hooks: Parameters<typeof mount>[2]): UiController {
  const c = mount(baseConfig, strings, hooks);
  c.setView('chat');
  return c;
}

describe('ui: attachment composer', () => {
  it('hides the attach button when the host provides no upload hook', () => {
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {} });
    expect($('.attach').hidden).toBe(true);
  });

  it('shows a chip and enables send once an upload resolves', async () => {
    const onUploadAttachment = vi.fn(
      (): Promise<UploadedAttachment> => Promise.resolve({ id: 'att_new' }),
    );
    const onSend = vi.fn();
    controller = mountChat({ onSend, onTypingIntent: () => {}, onUploadAttachment });
    expect($('.attach').hidden).toBe(false);
    expect($<HTMLButtonElement>('.send').disabled).toBe(true);

    const input = $<HTMLInputElement>('.attach-input');
    Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect($$('.att-chip')).toHaveLength(1);
    expect($$('.att-chip-uploading')).toHaveLength(1);
    expect($<HTMLButtonElement>('.send').disabled).toBe(true);

    await vi.waitFor(() => expect($$('.att-chip-ready')).toHaveLength(1));
    expect($<HTMLButtonElement>('.send').disabled).toBe(false);

    $('.composer').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(onSend).toHaveBeenCalledWith('', ['att_new']);
    expect($$('.att-chip')).toHaveLength(0);
  });

  it('marks a failed upload and keeps its id out of the send payload', async () => {
    const onUploadAttachment = vi.fn(
      (): Promise<UploadedAttachment> => Promise.reject(new Error('boom')),
    );
    const onSend = vi.fn();
    controller = mountChat({ onSend, onTypingIntent: () => {}, onUploadAttachment });

    const input = $<HTMLInputElement>('.attach-input');
    Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect($$('.att-chip-error')).toHaveLength(1));
    expect($('.composer-note').textContent).toBe(strings.attachFailed);
    expect($<HTMLButtonElement>('.send').disabled).toBe(true);

    $<HTMLTextAreaElement>('textarea').value = 'text anyway';
    $<HTMLTextAreaElement>('textarea').dispatchEvent(new Event('input'));
    $('.composer').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(onSend).toHaveBeenCalledWith('text anyway', []);
  });

  it('rejects a file outside the mime allowlist without calling the upload hook', () => {
    const onUploadAttachment = vi.fn(
      (): Promise<UploadedAttachment> => Promise.resolve({ id: 'nope' }),
    );
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {}, onUploadAttachment });

    const input = $<HTMLInputElement>('.attach-input');
    Object.defineProperty(input, 'files', {
      value: [new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));

    expect(onUploadAttachment).not.toHaveBeenCalled();
    expect($$('.att-chip')).toHaveLength(0);
    expect($('.composer-note').textContent).toBe(strings.attachTypeRejected);
  });

  it('drops a chip on its remove button', async () => {
    const onUploadAttachment = vi.fn(
      (): Promise<UploadedAttachment> => Promise.resolve({ id: 'att_x' }),
    );
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {}, onUploadAttachment });

    const input = $<HTMLInputElement>('.attach-input');
    Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect($$('.att-chip-ready')).toHaveLength(1));

    $<HTMLButtonElement>('.att-chip-drop').click();
    expect($$('.att-chip')).toHaveLength(0);
    expect($<HTMLButtonElement>('.send').disabled).toBe(true);
  });
});

describe('ui: attachment bubbles', () => {
  it('renders an image with no bubble when the message carries no text', () => {
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {} });
    controller.addMessages([
      msg({ id: 'm1', role: 'end_user', body: '', attachments: [attachment()] }),
    ]);
    const wrap = $('[data-message-id="m1"]');
    expect(wrap.querySelector('.bubble')).toBeNull();
    const img = wrap.querySelector('.msg-att img') as HTMLImageElement;
    expect(img.src).toBe('https://munin.example/v1/c/a/tok?w=320');
    expect(img.alt).toBe('shot.png');
  });

  it('keeps the bubble alongside the image when the message has text', () => {
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {} });
    controller.addMessages([
      msg({ id: 'm2', role: 'agent', body: 'here it is', attachments: [attachment()] }),
    ]);
    const wrap = $('[data-message-id="m2"]');
    expect(wrap.querySelector('.bubble')!.textContent).toContain('here it is');
    expect(wrap.querySelectorAll('.msg-att')).toHaveLength(1);
  });

  it('shows a placeholder for a tombstoned attachment instead of a broken image', () => {
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {} });
    controller.addMessages([
      msg({
        id: 'm3',
        role: 'end_user',
        body: 'gone',
        attachments: [attachment({ deleted: true, url: null, thumbnailUrl: null })],
      }),
    ]);
    const wrap = $('[data-message-id="m3"]');
    expect(wrap.querySelectorAll('img')).toHaveLength(0);
    expect(wrap.querySelector('.msg-att-gone')!.textContent).toBe(strings.attachmentUnavailable);
  });

  it('opens the lightbox on the full-size url when an image is clicked', () => {
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {} });
    controller.addMessages([
      msg({ id: 'm4', role: 'end_user', body: '', attachments: [attachment()] }),
    ]);
    expect($('.lightbox').hidden).toBe(true);
    $<HTMLButtonElement>('.msg-att').click();
    expect($('.lightbox').hidden).toBe(false);
    expect($<HTMLImageElement>('.lightbox-img').src).toBe('https://munin.example/v1/c/a/tok');
    $<HTMLButtonElement>('.lightbox-close').click();
    expect($('.lightbox').hidden).toBe(true);
  });
});
