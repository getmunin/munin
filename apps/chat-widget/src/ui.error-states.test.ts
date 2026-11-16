import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, type UiController, type UiHooks } from './ui.ts';
import type { WidgetConfig } from './config.ts';
import { attachmentTooLargeError } from './upload.ts';
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
  nudge: null,
  nudgeDelayMs: 8000,
};

const MB = 1024 * 1024;

let controller: UiController | null = null;

afterEach(() => {
  controller?.destroy();
  controller = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function shadowRoot(): ShadowRoot {
  const host = document.querySelector('[data-munin-widget]');
  if (!host?.shadowRoot) throw new Error('widget host not mounted');
  return host.shadowRoot;
}

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = shadowRoot().querySelector(selector);
  if (!el) throw new Error(`no element matched ${selector}`);
  return el as T;
}

function $$(selector: string): Element[] {
  return Array.from(shadowRoot().querySelectorAll(selector));
}

function mountChat(hooks: Partial<UiHooks>): UiController {
  const c = mount(baseConfig, strings, { onSend: () => {}, onTypingIntent: () => {}, ...hooks });
  c.setView('chat');
  return c;
}

function imageFile(name: string, type: string, bytes: number): File {
  const file = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

function pickFiles(files: File[]): void {
  const input = $<HTMLInputElement>('.attach-input');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

function typeAndSend(text: string): void {
  const textarea = $<HTMLTextAreaElement>('textarea');
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
  $('.composer').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

function noteText(): string | null {
  return $('.composer-note').hidden ? null : $('.composer-note-text').textContent;
}

describe('ui: a failed voice call', () => {
  it('tells the visitor once the call fails, after the call panel closes', () => {
    controller = mountChat({ onVoiceStart: () => {} });
    controller.setVoiceAvailable(true);
    controller.setVoiceState('connecting');
    controller.setVoiceState('error');

    expect($('.voice-call').hidden).toBe(true);
    expect(noteText()).toBe(strings.voiceFailed);
  });

  it('says nothing when a call ends normally', () => {
    controller = mountChat({ onVoiceStart: () => {} });
    controller.setVoiceAvailable(true);
    controller.setVoiceState('listening');
    controller.setVoiceState('ended');

    expect(noteText()).toBeNull();
  });
});

describe('ui: a failed send', () => {
  it('puts the text and images back in the composer', async () => {
    let rejectSend: (err: Error) => void = () => {};
    controller = mountChat({
      onSend: () => new Promise<void>((_, reject) => (rejectSend = reject)),
      onUploadAttachment: () => Promise.resolve({ id: 'att_1' }),
    });
    pickFiles([imageFile('a.png', 'image/png', 64)]);
    await vi.waitFor(() => expect($$('.att-chip-ready')).toHaveLength(1));

    typeAndSend('Where is my order?');
    expect($<HTMLTextAreaElement>('textarea').value).toBe('');
    expect($$('.att-chip')).toHaveLength(0);

    rejectSend(new Error('503'));
    await vi.waitFor(() => expect(noteText()).toBe(strings.sendFailed));
    expect($<HTMLTextAreaElement>('textarea').value).toBe('Where is my order?');
    expect($$('.att-chip-ready')).toHaveLength(1);
  });

  it('resends the restored images with their original ids', async () => {
    const onSend = vi.fn<UiHooks['onSend']>().mockRejectedValueOnce(new Error('503')).mockResolvedValue();
    controller = mountChat({ onSend, onUploadAttachment: () => Promise.resolve({ id: 'att_1' }) });
    pickFiles([imageFile('a.png', 'image/png', 64)]);
    await vi.waitFor(() => expect($$('.att-chip-ready')).toHaveLength(1));

    typeAndSend('first try');
    await vi.waitFor(() => expect(noteText()).toBe(strings.sendFailed));
    $('.composer').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    expect(onSend).toHaveBeenLastCalledWith('first try', ['att_1']);
  });

  it('keeps what the visitor typed since instead of overwriting it', async () => {
    let rejectSend: (err: Error) => void = () => {};
    controller = mountChat({ onSend: () => new Promise<void>((_, reject) => (rejectSend = reject)) });
    typeAndSend('original');
    $<HTMLTextAreaElement>('textarea').value = 'newer draft';

    rejectSend(new Error('503'));
    await vi.waitFor(() => expect(noteText()).toBe(strings.sendFailed));
    expect($<HTMLTextAreaElement>('textarea').value).toBe('newer draft');
  });

  it('drops the draft when the visitor has left for another conversation', async () => {
    let rejectSend: (err: Error) => void = () => {};
    controller = mountChat({ onSend: () => new Promise<void>((_, reject) => (rejectSend = reject)) });
    typeAndSend('for the old conversation');
    controller.resetChat();

    rejectSend(new Error('503'));
    await new Promise((r) => setTimeout(r, 0));
    expect($<HTMLTextAreaElement>('textarea').value).toBe('');
    expect(noteText()).toBeNull();
  });

  it('leaves the composer empty once the send succeeds', async () => {
    controller = mountChat({ onSend: () => Promise.resolve() });
    typeAndSend('hello');
    await new Promise((r) => setTimeout(r, 0));
    expect($<HTMLTextAreaElement>('textarea').value).toBe('');
    expect(noteText()).toBeNull();
  });
});

describe('ui: images over the size limit', () => {
  it('lets a large photo through to be downscaled', () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    const onUploadAttachment = vi.fn(() => new Promise<{ id: string }>(() => {}));
    controller = mountChat({ onUploadAttachment });
    pickFiles([imageFile('photo.jpg', 'image/jpeg', 12 * MB)]);

    expect(onUploadAttachment).toHaveBeenCalledTimes(1);
    expect(noteText()).toBeNull();
  });

  it('shows the size message when the photo is still too large after downscaling', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    controller = mountChat({
      onUploadAttachment: () => Promise.reject(attachmentTooLargeError(11 * MB)),
    });
    pickFiles([imageFile('photo.jpg', 'image/jpeg', 12 * MB)]);

    await vi.waitFor(() => expect(noteText()).toBe('Images have to be under 10 MB.'));
    expect($$('.att-chip')).toHaveLength(0);
  });

  it('refuses a large GIF up front, since GIFs are not re-encoded', () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    const onUploadAttachment = vi.fn();
    controller = mountChat({ onUploadAttachment });
    pickFiles([imageFile('anim.gif', 'image/gif', 12 * MB)]);

    expect(onUploadAttachment).not.toHaveBeenCalled();
    expect(noteText()).toBe('Images have to be under 10 MB.');
  });

  it('refuses a file too large to decode safely', () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    const onUploadAttachment = vi.fn();
    controller = mountChat({ onUploadAttachment });
    pickFiles([imageFile('huge.png', 'image/png', 60 * MB)]);

    expect(onUploadAttachment).not.toHaveBeenCalled();
  });

  it('refuses a large file when the browser cannot downscale', () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const onUploadAttachment = vi.fn();
    controller = mountChat({ onUploadAttachment });
    pickFiles([imageFile('photo.jpg', 'image/jpeg', 12 * MB)]);

    expect(onUploadAttachment).not.toHaveBeenCalled();
  });
});

describe('ui: presence while the connection is down', () => {
  it('says Offline with the reconnecting bar, and Online now once back', () => {
    vi.useFakeTimers();
    try {
      controller = mountChat({});
      controller.setConnectionState('connected');
      expect($('.chat-sub-label').textContent).toBe(strings.onlineNow);

      controller.setConnectionState('reconnecting');
      vi.advanceTimersByTime(2000);
      expect($('.status').textContent).toBe(strings.statusReconnecting);
      expect($('.chat-sub-label').textContent).toBe(strings.statusOffline);
      expect($('.chat-sub').classList.contains('offline')).toBe(true);

      controller.setConnectionState('connected');
      expect($('.chat-sub-label').textContent).toBe(strings.onlineNow);
      expect($('.chat-sub').classList.contains('offline')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps showing Online now through a blip shorter than the grace period', () => {
    vi.useFakeTimers();
    try {
      controller = mountChat({});
      controller.setConnectionState('reconnecting');
      vi.advanceTimersByTime(500);
      controller.setConnectionState('connected');
      vi.advanceTimersByTime(2000);
      expect($('.chat-sub-label').textContent).toBe(strings.onlineNow);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ui: files that are not images', () => {
  function pdf(): File {
    return new File(['pdf bytes'], 'invoice.pdf', { type: 'application/pdf' });
  }

  it('explains which types are accepted when a PDF is dropped', () => {
    const onUploadAttachment = vi.fn();
    controller = mountChat({ onUploadAttachment });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [pdf()] } });
    $('.chat').dispatchEvent(drop);

    expect(onUploadAttachment).not.toHaveBeenCalled();
    expect(noteText()).toBe(strings.attachTypeRejected);
  });

  it('explains which types are accepted when a PDF is pasted', () => {
    controller = mountChat({ onUploadAttachment: vi.fn() });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [pdf()] } });
    $('textarea').dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(noteText()).toBe(strings.attachTypeRejected);
  });

  it('leaves a plain text paste alone', () => {
    controller = mountChat({ onUploadAttachment: vi.fn() });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [] } });
    $('textarea').dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(false);
    expect(noteText()).toBeNull();
  });
});

describe('ui: retrying a failed upload', () => {
  it('uploads the same file again from the failed thumbnail', async () => {
    const onUploadAttachment = vi
      .fn<NonNullable<UiHooks['onUploadAttachment']>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ id: 'att_2' });
    controller = mountChat({ onUploadAttachment });
    const file = imageFile('a.png', 'image/png', 64);
    pickFiles([file]);
    await vi.waitFor(() => expect(noteText()).toBe(strings.attachFailed));

    const retry = $<HTMLButtonElement>('.att-chip-retry');
    expect(retry.getAttribute('aria-label')).toBe(strings.attachRetryAriaLabel);
    retry.click();

    expect(onUploadAttachment).toHaveBeenLastCalledWith(file);
    expect(noteText()).toBeNull();
    await vi.waitFor(() => expect($$('.att-chip-ready')).toHaveLength(1));
    expect(shadowRoot().querySelector('.att-chip-retry')).toBeNull();
  });

  it('offers no retry while an upload is still in progress', () => {
    controller = mountChat({ onUploadAttachment: () => new Promise(() => {}) });
    pickFiles([imageFile('a.png', 'image/png', 64)]);
    expect(shadowRoot().querySelector('.att-chip-retry')).toBeNull();
  });
});

describe('ui: email that did not save', () => {
  it('shows the error on the card and clears it on the next attempt', () => {
    const onSetVisitorEmail = vi.fn();
    controller = mountChat({ onSetVisitorEmail });
    controller.showEmailCard();
    controller.setEmailFailed();
    expect($('.card-error').textContent).toBe(strings.emailSaveFailed);
    expect($('.card-error').getAttribute('role')).toBe('alert');

    $<HTMLInputElement>('.card-form input').value = 'kari@example.com';
    $('.card-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(onSetVisitorEmail).toHaveBeenCalledWith('kari@example.com');
    expect(shadowRoot().querySelector('.card-error')).toBeNull();
  });

  it('ignores a late failure once the email is saved', () => {
    controller = mountChat({});
    controller.showEmailCard();
    controller.setEmailSaved('kari@example.com');
    controller.setEmailFailed();
    expect(shadowRoot().querySelector('.card-error')).toBeNull();
  });
});

describe('ui: history that did not load', () => {
  it('shows a status line until history loads', () => {
    controller = mountChat({});
    controller.setHistoryFailed(true);
    expect($('.status').hidden).toBe(false);
    expect($('.status').textContent).toBe(strings.historyLoadFailed);

    controller.setHistoryFailed(false);
    expect($('.status').hidden).toBe(true);
  });

  it('lets the connection status take priority, then falls back', () => {
    controller = mountChat({});
    controller.setHistoryFailed(true);
    controller.setConnectionState('closed');
    expect($('.status').textContent).toBe(strings.statusDisconnected);

    controller.setConnectionState('connected');
    expect($('.status').textContent).toBe(strings.historyLoadFailed);
  });
});
