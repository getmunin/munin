import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { DraftEditor } from './draft-editor';
import type { DraftEdit } from './draft-edit';
import type { JourneyValidation, JourneyVersionDto } from './journey-types';

function version(number: number, specHash: string, subject = 'Welcome'): JourneyVersionDto {
  return {
    number,
    parentVersion: null,
    changeSummary: null,
    spec: {
      entry: { trigger: { type: 'manual' } },
      goal: { event: 'subscription.started', windowDays: 30 },
      settings: {},
      start: 'welcome',
      nodes: [
        { id: 'welcome', type: 'message', channel: 'email', content: { subject, body: 'Hi {{name}}' }, next: 'done' },
        { id: 'done', type: 'exit' },
      ],
    },
    specHash,
    validation: null,
    createdBy: { type: 'user', id: 'usr_1' },
    publishRequestedAt: null,
    publishedAt: null,
    publishedByActorId: null,
    createdAt: new Date().toISOString(),
  };
}

const valid: JourneyValidation = { valid: true, errors: [], warnings: [] };

function stale() {
  return Object.assign(new Error('journeys_draft_changed: changed'), { code: 'journeys_draft_changed' });
}

describe('DraftEditor', () => {
  it('saves against the hash it last saw, validates the saved version, and reloads when the draft went stale', async () => {
    const edits: { change: DraftEdit; ifSpecHash: string }[] = [];
    const edit = vi.fn((change: DraftEdit, ifSpecHash: string) => {
      edits.push({ change, ifSpecHash });
      return edits.length === 1 ? Promise.resolve(version(2, 'hash-2', 'Hello')) : Promise.reject(stale());
    });
    const validate = vi.fn(() => Promise.resolve(valid));
    const onStale = vi.fn();
    renderWithProviders(<DraftEditor version={version(2, 'hash-1')} edit={edit} validate={validate} onStale={onStale} />);

    fireEvent.click(screen.getByRole('button', { name: 'welcome' }));
    fireEvent.change(screen.getByDisplayValue('Welcome'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save step' }));
    await waitFor(() => expect(validate).toHaveBeenCalledWith(2));
    expect(edits[0]).toMatchObject({ ifSpecHash: 'hash-1', change: { kind: 'updateNode', node: { content: { subject: 'Hello' } } } });
    expect(await screen.findByText('The draft is valid. Publish it from the Versions tab.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save step' }));
    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
    expect(edits[1]!.ifSpecHash).toBe('hash-2');
    expect(validate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toContain('This journey changed while you were editing it.');
  });

  it('adds a new step between the selected step and the one it led to', async () => {
    const edit = vi.fn((_change: DraftEdit, _hash: string) => Promise.resolve(version(2, 'hash-2')));
    renderWithProviders(
      <DraftEditor version={version(2, 'hash-1')} edit={edit} validate={() => Promise.resolve(valid)} onStale={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'welcome' }));
    fireEvent.change(screen.getByLabelText('Kind of step'), { target: { value: 'wait' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect(edit.mock.calls[0]![0]).toEqual({
      kind: 'addNode',
      node: { id: 'wait', type: 'wait', duration: 'P1D', next: 'done' },
      after: { nodeId: 'welcome', edge: 'next' },
    });
  });
});
