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
    expect($('.composer-note-text').textContent).toBe(strings.attachFailed);
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
    expect($('.composer-note-text').textContent).toBe(strings.attachTypeRejected);
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

  it('ignores an injected element carrying a plausible url in a data attribute, because the handler reads no DOM text', () => {
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {} });
    controller.addMessages([
      msg({ id: 'm5', role: 'end_user', body: '', attachments: [attachment()] }),
    ]);

    const planted = $('[data-message-id="m5"]').ownerDocument.createElement('span');
    planted.setAttribute('data-lightbox', '');
    planted.setAttribute('data-lightbox-src', 'https://evil.example/planted.png');
    $('[data-message-id="m5"]').appendChild(planted);

    planted.click();
    expect($('.lightbox').hidden).toBe(true);
    expect($<HTMLImageElement>('.lightbox-img').getAttribute('src')).toBeNull();
  });

  it('refuses a non-http attachment url rather than assigning it to an image source', () => {
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {} });
    controller.addMessages([
      msg({
        id: 'm6',
        role: 'end_user',
        body: '',
        attachments: [{ ...attachment(), url: 'javascript:alert(1)', thumbnailUrl: null }],
      }),
    ]);

    $<HTMLButtonElement>('[data-message-id="m6"] .msg-att').click();
    expect($('.lightbox').hidden).toBe(true);
    expect($<HTMLImageElement>('.lightbox-img').getAttribute('src')).toBeNull();
    expect(
      $<HTMLImageElement>('[data-message-id="m6"] .msg-att img').getAttribute('src'),
    ).toBeNull();
  });
});

describe('ui: drag-and-drop hint', () => {
  function dragEvent(type: string, init: { relatedTarget?: EventTarget | null } = {}): Event {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', {
      value: { types: ['Files'], files: [] },
      configurable: true,
    });
    if ('relatedTarget' in init) {
      Object.defineProperty(e, 'relatedTarget', {
        value: init.relatedTarget,
        configurable: true,
      });
    }
    return e;
  }

  it('hides the hint when the drag leaves the panel from over a descendant', () => {
    controller = mountChat({
      onSend: () => {},
      onTypingIntent: () => {},
      onUploadAttachment: () => Promise.resolve({ id: 'att' }),
    });
    controller.addMessages([msg({ id: 'm1', role: 'end_user', body: 'hello' })]);

    const chat = $('.chat');
    const inner = $('[data-message-id="m1"]');
    chat.dispatchEvent(dragEvent('dragover'));
    expect($('.drop-hint').hidden).toBe(false);

    inner.dispatchEvent(dragEvent('dragleave', { relatedTarget: document.body }));
    expect($('.drop-hint').hidden).toBe(true);
  });

  it('hides the hint when the drag leaves the window entirely', () => {
    controller = mountChat({
      onSend: () => {},
      onTypingIntent: () => {},
      onUploadAttachment: () => Promise.resolve({ id: 'att' }),
    });

    const chat = $('.chat');
    chat.dispatchEvent(dragEvent('dragover'));
    expect($('.drop-hint').hidden).toBe(false);

    chat.dispatchEvent(dragEvent('dragleave', { relatedTarget: null }));
    expect($('.drop-hint').hidden).toBe(true);
  });

  it('keeps the hint while the drag moves between elements inside the panel', () => {
    controller = mountChat({
      onSend: () => {},
      onTypingIntent: () => {},
      onUploadAttachment: () => Promise.resolve({ id: 'att' }),
    });
    controller.addMessages([msg({ id: 'm1', role: 'end_user', body: 'hello' })]);

    const chat = $('.chat');
    const inner = $('[data-message-id="m1"]');
    chat.dispatchEvent(dragEvent('dragover'));
    expect($('.drop-hint').hidden).toBe(false);

    chat.dispatchEvent(dragEvent('dragleave', { relatedTarget: inner }));
    expect($('.drop-hint').hidden).toBe(false);
  });
});

describe('ui: composer note', () => {
  it('keeps the note up until it is dismissed rather than timing out', async () => {
    vi.useFakeTimers();
    try {
      controller = mountChat({
        onSend: () => {},
        onTypingIntent: () => {},
        onUploadAttachment: () => Promise.reject(new Error('boom')),
      });
      const input = $<HTMLInputElement>('.attach-input');
      Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect($('.composer-note').hidden).toBe(false));

      vi.advanceTimersByTime(60_000);
      expect($('.composer-note').hidden).toBe(false);

      $<HTMLButtonElement>('.composer-note-close').click();
      expect($('.composer-note').hidden).toBe(true);
      expect($('.composer-note-text').textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the note as an alert so assistive tech announces it', () => {
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {} });
    expect($('.composer-note').getAttribute('role')).toBe('alert');
  });

  it('surfaces a send failure through the same note', () => {
    controller = mountChat({ onSend: () => {}, onTypingIntent: () => {} });
    controller.showComposerError(strings.sendFailed);
    expect($('.composer-note').hidden).toBe(false);
    expect($('.composer-note-text').textContent).toBe(strings.sendFailed);
  });

  it('clears the note once a message actually goes out', async () => {
    const onSend = vi.fn();
    controller = mountChat({
      onSend,
      onTypingIntent: () => {},
      onUploadAttachment: () => Promise.reject(new Error('boom')),
    });
    const input = $<HTMLInputElement>('.attach-input');
    Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect($('.composer-note').hidden).toBe(false));

    $<HTMLTextAreaElement>('textarea').value = 'sending anyway';
    $<HTMLTextAreaElement>('textarea').dispatchEvent(new Event('input'));
    $('.composer').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    expect(onSend).toHaveBeenCalledWith('sending anyway', []);
    expect($('.composer-note').hidden).toBe(true);
  });
});
