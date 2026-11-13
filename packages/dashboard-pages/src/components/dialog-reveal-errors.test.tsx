import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle } from '@getmunin/ui';
import { renderWithProviders } from '../test/render';

function rectFor(el: Element): DOMRect {
  const data = el instanceof HTMLElement ? el.dataset : {};
  return DOMRect.fromRect({
    x: 0,
    y: Number(data.top ?? 0),
    width: 100,
    height: Number(data.height ?? 20),
  });
}

function ScrollingForm({ errorTop }: { errorTop: number }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Edit channel</DialogTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('Choose how the agent replies.');
          }}
        >
          <div data-scroller="" data-top="0" data-height="400" style={{ overflowY: 'auto' }}>
            <input aria-label="Name" defaultValue="Support" />
            {error ? (
              <p role="alert" data-top={errorTop}>
                {error}
              </p>
            ) : null}
          </div>
          <button type="submit">Save</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

describe('DialogContent reveals validation errors', () => {
  let scrollIntoView: MockInstance<(arg?: boolean | ScrollIntoViewOptions) => void>;

  beforeEach(() => {
    scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return rectFor(this);
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return 'scroller' in this.dataset ? 1200 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return 'scroller' in this.dataset ? 400 : 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scrolls an error that appears below the visible area into view', async () => {
    renderWithProviders(<ScrollingForm errorTop={900} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts[0]).toBe(alert);
  });

  it('leaves the scroll position alone when the error is already visible', async () => {
    renderWithProviders(<ScrollingForm errorTop={200} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls back to an unchanged error when the form is submitted again', async () => {
    renderWithProviders(<ScrollingForm errorTop={900} />);
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    fireEvent.click(save);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
  });
});
