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
