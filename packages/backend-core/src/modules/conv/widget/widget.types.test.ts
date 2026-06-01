import { describe, expect, it } from 'vitest';
import { WidgetIngestMessage } from './widget.types.ts';

describe('WidgetIngestMessage role gate', () => {
  it('accepts end_user (explicit)', () => {
    const r = WidgetIngestMessage.safeParse({ role: 'end_user', body: 'hi' });
    expect(r.success).toBe(true);
  });

  it('defaults role to end_user when omitted', () => {
    const r = WidgetIngestMessage.safeParse({ body: 'hi' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.role).toBe('end_user');
  });

  it('rejects role=agent', () => {
    const r = WidgetIngestMessage.safeParse({ role: 'agent', body: 'i am the AI' });
    expect(r.success).toBe(false);
  });

  it('rejects role=system', () => {
    const r = WidgetIngestMessage.safeParse({ role: 'system', body: 'system msg' });
    expect(r.success).toBe(false);
  });
});
