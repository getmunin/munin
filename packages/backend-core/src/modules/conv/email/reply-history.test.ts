import { describe, expect, it } from 'vitest';
import { splitSignatureText, stripSignatureText } from './reply-history.js';

describe('splitSignatureText', () => {
  it('returns null signature when no opener present', () => {
    const r = splitSignatureText('Hi there,\n\nQuick question about pricing.');
    expect(r.signature).toBeNull();
    expect(r.clean).toBe('Hi there,\n\nQuick question about pricing.');
  });

  it('preserves iPhone tagline as signature', () => {
    const r = splitSignatureText('Sure, sounds good!\n\nSent from my iPhone');
    expect(r.clean).toBe('Sure, sounds good!');
    expect(r.signature).toBe('Sent from my iPhone');
  });

  it('preserves a -- delimited block as signature', () => {
    const body = 'Thanks for the help.\n\n--\nJane Doe\nHead of Ops\nAcme';
    const r = splitSignatureText(body);
    expect(r.clean).toBe('Thanks for the help.');
    expect(r.signature).toBe('--\nJane Doe\nHead of Ops\nAcme');
  });

  it('preserves underscore horizontal rule as signature', () => {
    const body = 'Confirmed.\n\n________________________\nJane Doe';
    const r = splitSignatureText(body);
    expect(r.signature).toContain('Jane Doe');
    expect(r.clean).toBe('Confirmed.');
  });

  it('returns body unchanged when stripping would leave nothing', () => {
    const r = splitSignatureText('Sent from my iPhone');
    expect(r.clean).toBe('Sent from my iPhone');
    expect(r.signature).toBeNull();
  });

  it('stripSignatureText remains a thin wrapper returning clean only', () => {
    const body = 'Hello\n\nSent from my iPhone';
    expect(stripSignatureText(body)).toBe('Hello');
  });

  it('handles empty input', () => {
    expect(splitSignatureText('')).toEqual({ clean: '', signature: null });
  });
});
