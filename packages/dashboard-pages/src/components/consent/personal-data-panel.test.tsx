import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { renderWithProviders } from '../../test/render';
import { PersonalDataPanel } from './personal-data-panel';

function Harness({ rawRequested }: { rawRequested: boolean }) {
  const [shareRaw, setShareRaw] = useState(false);
  return (
    <PersonalDataPanel
      clientName="Claude"
      rawRequested={rawRequested}
      shareRaw={shareRaw}
      onShareRawChange={setShareRaw}
    />
  );
}

function panel(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-personal-data]')!;
}

describe('PersonalDataPanel', () => {
  it('states that data is pseudonymized, with no toggle, when raw access was not requested', () => {
    const { container } = renderWithProviders(<Harness rawRequested={false} />);
    expect(panel(container).dataset.personalData).toBe('pseudonymized');
    expect(screen.getByText('Pseudonymized')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('defaults a raw-access request to pseudonymized until the box is ticked', () => {
    const { container } = renderWithProviders(<Harness rawRequested />);
    const box = screen.getByRole('checkbox');
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(panel(container).dataset.personalData).toBe('pseudonymized');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('renders raw access visibly apart from the pseudonymized default once ticked', () => {
    const { container } = renderWithProviders(<Harness rawRequested />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(panel(container).dataset.personalData).toBe('raw');
    expect(screen.getByText('Raw')).toBeTruthy();
    expect(screen.queryByText('Pseudonymized')).toBeNull();
    expect(screen.getByRole('note').textContent).toContain('Claude');
  });

  it('states the org requirement instead of offering a choice the org has already made', () => {
    const { container } = renderWithProviders(
      <PersonalDataPanel
        clientName="Claude"
        rawRequested
        shareRaw
        onShareRawChange={() => {}}
        orgRequiresPseudonymization
      />,
    );
    expect(panel(container).dataset.personalData).toBe('pseudonymized');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(container.textContent).toContain('requires pseudonymized personal data');
  });

  it('warns that unknown names can still appear while name detection catches up, unless raw was chosen', () => {
    const { container, rerender } = renderWithProviders(
      <PersonalDataPanel
        clientName="Claude"
        rawRequested
        shareRaw={false}
        onShareRawChange={() => {}}
        coverageNotice="pending"
      />,
    );
    expect(container.querySelector('[data-coverage-notice="pending"]')?.textContent).toContain(
      'still checking older messages',
    );
    rerender(
      <PersonalDataPanel clientName="Claude" rawRequested shareRaw onShareRawChange={() => {}} coverageNotice="pending" />,
    );
    expect(container.querySelector('[data-coverage-notice]')).toBeNull();
  });

  it('says unchecked text is withheld when the org has strict mode on', () => {
    const { container } = renderWithProviders(
      <PersonalDataPanel
        clientName="Claude"
        rawRequested={false}
        shareRaw={false}
        onShareRawChange={() => {}}
        coverageNotice="withheldNoNer"
      />,
    );
    expect(container.querySelector('[data-coverage-notice]')?.textContent).toContain('withheld');
  });

  it('reports the choice to its owner', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PersonalDataPanel clientName="Claude" rawRequested shareRaw={false} onShareRawChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
