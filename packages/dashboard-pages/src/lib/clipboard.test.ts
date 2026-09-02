import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

function stubDocument(execCommand: () => boolean) {
  const removed: unknown[] = [];
  const field = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  vi.stubGlobal('document', {
    body: { appendChild: vi.fn(), removeChild: vi.fn((el: unknown) => removed.push(el)) },
    createElement: vi.fn(() => field),
    getSelection: vi.fn(() => null),
    execCommand: vi.fn(execCommand),
  });
  return { field, removed };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('uses the async clipboard when the page is a secure context', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubDocument(() => false);

    await expect(copyText('mcp.getmunin.com')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('mcp.getmunin.com');
  });

  it('falls back to a selection copy when navigator.clipboard is absent', async () => {
    vi.stubGlobal('navigator', {});
    const { field } = stubDocument(() => true);

    await expect(copyText('mcp.getmunin.com')).resolves.toBe(true);
    expect(field.value).toBe('mcp.getmunin.com');
  });

  it('falls back when the async clipboard rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
    });
    stubDocument(() => true);

    await expect(copyText('secret')).resolves.toBe(true);
  });

  it('reports failure instead of throwing when neither path works', async () => {
    vi.stubGlobal('navigator', {});
    stubDocument(() => false);

    await expect(copyText('secret')).resolves.toBe(false);
  });

  it('removes the temporary field even when the copy command fails', async () => {
    vi.stubGlobal('navigator', {});
    const { field, removed } = stubDocument(() => {
      throw new Error('not allowed');
    });

    await expect(copyText('secret')).resolves.toBe(false);
    expect(removed).toEqual([field]);
  });
});
