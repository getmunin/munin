import { describe, expect, it, vi } from 'vitest';
import {
  attachmentPlaceholder,
  imageBudgetChars,
  isSupportedImageMime,
  loadHistoryImages,
  modelSupportsVision,
  normalizeModelId,
  VISION_IMAGE_HISTORY_CHAR_COST,
  VISION_MAX_IMAGES_PER_TURN,
  type ImageFetch,
} from './vision.ts';
import type { ConversationAttachment } from './types.ts';

function imageResponse(bytes: number, status = 200): Awaited<ReturnType<ImageFetch>> {
  const body = new Uint8Array(bytes).fill(7);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === 'content-length' ? String(bytes) : null) },
    arrayBuffer: () => Promise.resolve(body.buffer),
  };
}

function attachment(over: Partial<ConversationAttachment> = {}): ConversationAttachment {
  return { mime: 'image/png', url: 'https://munin.test/v1/c/a/tok', name: 'photo.jpg', ...over };
}

describe('modelSupportsVision', () => {
  it('accepts the Claude, OpenAI and Gemini families the presets actually point at', () => {
    for (const model of [
      'claude-opus-5',
      'claude-haiku-4-5',
      'anthropic/claude-haiku-4.5',
      'claude-3-5-sonnet-latest',
      'gpt-4o-mini',
      'openai/gpt-4.1',
      'gpt-5',
      'gemini-2.5-pro',
    ]) {
      expect(modelSupportsVision(model), model).toBe(true);
    }
  });

  it('refuses to assume vision for a model that is not on the allow-list', () => {
    for (const model of [
      'gpt-3.5-turbo',
      'claude-2.1',
      'claude-instant-1',
      'mistralai/mistral-7b-instruct',
      'deepseek-chat',
      '',
    ]) {
      expect(modelSupportsVision(model), model).toBe(false);
    }
  });

  it('strips the openrouter vendor prefix and route suffix before matching', () => {
    expect(normalizeModelId('anthropic/claude-opus-5:beta')).toBe('claude-opus-5');
    expect(modelSupportsVision('anthropic/claude-opus-5:beta')).toBe(true);
  });
});

describe('isSupportedImageMime', () => {
  it('mirrors the attachment store allow-list and rejects svg', () => {
    expect(isSupportedImageMime('image/png')).toBe(true);
    expect(isSupportedImageMime('image/webp')).toBe(true);
    expect(isSupportedImageMime('image/svg+xml')).toBe(false);
    expect(isSupportedImageMime('application/pdf')).toBe(false);
  });
});

describe('loadHistoryImages', () => {
  it('base64-encodes the downloaded bytes rather than passing the signed url on', async () => {
    const fetchImage = vi.fn<ImageFetch>(() => Promise.resolve(imageResponse(3)));
    const turns = await loadHistoryImages([{ attachments: [attachment()] }], {
      visionEnabled: true,
      fetch: fetchImage,
    });

    expect(fetchImage).toHaveBeenCalledWith('https://munin.test/v1/c/a/tok');
    expect(turns[0]?.images).toEqual([
      { mime: 'image/png', base64: Buffer.from(new Uint8Array(3).fill(7)).toString('base64') },
    ]);
    expect(turns[0]?.notes).toEqual([]);
  });

  it('falls back to a text placeholder for every attachment when the model has no vision', async () => {
    const fetchImage = vi.fn<ImageFetch>(() => Promise.resolve(imageResponse(3)));
    const turns = await loadHistoryImages([{ attachments: [attachment()] }], {
      visionEnabled: false,
      fetch: fetchImage,
    });

    expect(fetchImage).not.toHaveBeenCalled();
    expect(turns[0]?.images).toEqual([]);
    expect(turns[0]?.notes).toEqual(['[customer attached photo.jpg]']);
  });

  it('degrades to a placeholder when the serve route 404s a deleted image', async () => {
    const turns = await loadHistoryImages([{ attachments: [attachment()] }], {
      visionEnabled: true,
      fetch: () => Promise.resolve(imageResponse(0, 404)),
    });

    expect(turns[0]?.images).toEqual([]);
    expect(turns[0]?.notes).toEqual(['[customer attached photo.jpg — no longer available]']);
  });

  it('degrades to a placeholder instead of throwing when the download itself fails', async () => {
    const turns = await loadHistoryImages([{ attachments: [attachment()] }], {
      visionEnabled: true,
      fetch: () => Promise.reject(new Error('socket hang up')),
    });

    expect(turns[0]?.images).toEqual([]);
    expect(turns[0]?.notes).toEqual(['[customer attached photo.jpg — could not be loaded]']);
  });

  it('placeholders a tombstoned attachment, whose projected url is null', async () => {
    const fetchImage = vi.fn<ImageFetch>(() => Promise.resolve(imageResponse(3)));
    const turns = await loadHistoryImages(
      [{ attachments: [attachment({ url: null, name: 'receipt.png' })] }],
      { visionEnabled: true, fetch: fetchImage },
    );

    expect(fetchImage).not.toHaveBeenCalled();
    expect(turns[0]?.notes).toEqual(['[customer attached receipt.png]']);
  });

  it('clamps to the per-turn image cap and placeholders the overflow', async () => {
    const turns = await loadHistoryImages(
      [{ attachments: Array.from({ length: 6 }, () => attachment()) }],
      { visionEnabled: true, fetch: () => Promise.resolve(imageResponse(4)), maxImagesPerTurn: 2 },
    );

    expect(turns[0]?.images).toHaveLength(2);
    expect(turns[0]?.notes).toEqual(
      Array.from({ length: 4 }, () => '[customer attached photo.jpg — not shown, image limit reached]'),
    );
  });

  it('rejects a single image over the per-image byte cap without buffering it', async () => {
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    const turns = await loadHistoryImages([{ attachments: [attachment()] }], {
      visionEnabled: true,
      maxImageBytes: 100,
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => '5000' },
          arrayBuffer,
        }),
    });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(turns[0]?.images).toEqual([]);
    expect(turns[0]?.notes).toEqual(['[customer attached photo.jpg — too large to show]']);
  });

  it('rejects an image whose real body exceeds the cap even when content-length lied', async () => {
    const turns = await loadHistoryImages([{ attachments: [attachment()] }], {
      visionEnabled: true,
      maxImageBytes: 10,
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => '4' },
          arrayBuffer: () => Promise.resolve(new Uint8Array(4000).buffer),
        }),
    });

    expect(turns[0]?.images).toEqual([]);
    expect(turns[0]?.notes).toEqual(['[customer attached photo.jpg — too large to show]']);
  });

  it('spends the total byte budget on the newest turn and placeholders older images', async () => {
    const turns = await loadHistoryImages(
      [
        { attachments: [attachment({ name: 'oldest.png' })] },
        { attachments: [attachment({ name: 'newest.png' })] },
      ],
      {
        visionEnabled: true,
        maxTotalImageBytes: 100,
        fetch: () => Promise.resolve(imageResponse(100)),
      },
    );

    expect(turns[1]?.images).toHaveLength(1);
    expect(turns[0]?.images).toEqual([]);
    expect(turns[0]?.notes).toEqual(['[customer attached oldest.png — not shown, image limit reached]']);
  });

  it('never lets one turn exceed the remaining total budget', async () => {
    const turns = await loadHistoryImages(
      [{ attachments: [attachment(), attachment()] }],
      {
        visionEnabled: true,
        maxImageBytes: 1_000,
        maxTotalImageBytes: 60,
        fetch: () => Promise.resolve(imageResponse(50)),
      },
    );

    expect(turns[0]?.images).toHaveLength(1);
    expect(turns[0]?.notes).toEqual(['[customer attached photo.jpg — too large to show]']);
  });

  it('leaves turns without attachments untouched', async () => {
    const turns = await loadHistoryImages([{}, { attachments: [] }], {
      visionEnabled: true,
      fetch: () => Promise.reject(new Error('should not fetch')),
    });

    expect(turns).toEqual([
      { images: [], notes: [] },
      { images: [], notes: [] },
    ]);
  });
});

describe('imageBudgetChars', () => {
  it('charges history budget per shown image so images cannot ride along for free', () => {
    expect(imageBudgetChars(0)).toBe(0);
    expect(imageBudgetChars(1)).toBe(VISION_IMAGE_HISTORY_CHAR_COST);
  });

  it('stops charging past the per-turn cap, because the overflow is only a placeholder', () => {
    expect(imageBudgetChars(50)).toBe(VISION_MAX_IMAGES_PER_TURN * VISION_IMAGE_HISTORY_CHAR_COST);
  });
});

describe('attachmentPlaceholder', () => {
  it('names the file so the agent can still refer to what it cannot see', () => {
    expect(attachmentPlaceholder(attachment({ name: 'invoice.pdf' }))).toBe(
      '[customer attached invoice.pdf]',
    );
  });

  it('derives a label from the mime type when the projection carried no name', () => {
    expect(attachmentPlaceholder(attachment({ name: undefined }))).toBe(
      '[customer attached image.png]',
    );
  });
});
