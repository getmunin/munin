import { describe, expect, it } from 'vitest';
import { openDraftSlots, parseDraftMarkup } from './draft-markup.ts';

describe('parseDraftMarkup', () => {
  it('returns plain text untouched with no annotation or slots', () => {
    expect(parseDraftMarkup('Hei, Kari. Bordet er klart.')).toEqual({
      body: 'Hei, Kari. Bordet er klart.',
      annotated: null,
      slots: [],
    });
  });

  it('unwraps agent-added spans and keeps the marked-up original', () => {
    const raw = 'Kake er greit. [[Vi skjærer den opp og serverer den til kaffen.]]';
    expect(parseDraftMarkup(raw)).toEqual({
      body: 'Kake er greit. Vi skjærer den opp og serverer den til kaffen.',
      annotated: raw,
      slots: [],
    });
  });

  it('renders each missing fact as a bracketed slot and lists it once', () => {
    const parsed = parseDraftMarkup(
      'Ordren din sendes {{ LEVERINGSDATO }}. Vi bekrefter {{LEVERINGSDATO}} på e-post.',
    );
    expect(parsed.body).toBe('Ordren din sendes [LEVERINGSDATO]. Vi bekrefter [LEVERINGSDATO] på e-post.');
    expect(parsed.slots).toEqual(['[LEVERINGSDATO]']);
  });

  it('keeps paragraph breaks inside and around markup', () => {
    const parsed = parseDraftMarkup('Hei.\n\n[[Depositumet trekkes\nfra regningen.]]');
    expect(parsed.body).toBe('Hei.\n\nDepositumet trekkes\nfra regningen.');
  });

  it('drops unbalanced markers so they never reach the customer', () => {
    expect(parseDraftMarkup('Takk [[for bestillingen. Vi sees }}').body).toBe(
      'Takk for bestillingen. Vi sees ',
    );
  });

  it('treats an empty slot as a stray marker', () => {
    expect(parseDraftMarkup('Pris: {{}} kr').body).toBe('Pris:  kr');
  });
});

describe('openDraftSlots', () => {
  it('lists the slots still present in the text being sent', () => {
    expect(openDraftSlots(['[DATO]', '[BELØP]'], 'Vi leverer 3. oktober. Beløp: [BELØP].')).toEqual([
      '[BELØP]',
    ]);
  });

  it('is empty once every slot is filled in', () => {
    expect(openDraftSlots(['[DATO]'], 'Vi leverer 3. oktober.')).toEqual([]);
  });
});
