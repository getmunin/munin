import { describe, it, expect } from 'vitest';
import { StubMailer } from './mailer.js';

describe('StubMailer', () => {
  it('captures sent messages in outbox', async () => {
    const m = new StubMailer('test@example.com');
    await m.send({ to: 'kjell@example.com', subject: 'Hi', text: 'Hello' });
    expect(m.outbox).toHaveLength(1);
    expect(m.outbox[0]!.to).toBe('kjell@example.com');
    expect(m.outbox[0]!.subject).toBe('Hi');
    expect(m.outbox[0]!.text).toBe('Hello');
    expect(m.outbox[0]!.sentAt).toBeInstanceOf(Date);
  });

  it('default from is exposed', () => {
    const m = new StubMailer('me@example.com');
    expect(m.from).toBe('me@example.com');
    expect(m.name).toBe('stub');
  });

  it('clear() empties the outbox', async () => {
    const m = new StubMailer();
    await m.send({ to: 'a@example.com', subject: 'x', text: 'y' });
    m.clear();
    expect(m.outbox).toHaveLength(0);
  });
});
