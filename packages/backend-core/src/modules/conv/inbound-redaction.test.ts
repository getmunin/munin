import { describe, expect, it } from 'vitest';
import { applyInboundRedaction, REDACTION_OFF } from './inbound-redaction.ts';
import {
  isRedactionConfigured,
  parseRedactionPolicy,
  REDACTION_SETTINGS_KEY,
} from './redaction-policy.ts';

const NO_SYNTHETIC = '01819012365';

const REMOVE_NO = {
  detectors: ['no_fnr'] as const,
  policy: 'remove' as const,
  minConfidence: 'high' as const,
};

describe('applyInboundRedaction', () => {
  it('detects without mutating while the policy is off', () => {
    const result = applyInboundRedaction({ body: `fnr ${NO_SYNTHETIC}` }, REDACTION_OFF);
    expect(result.fields.body).toBe(`fnr ${NO_SYNTHETIC}`);
    expect(result.redacted).toBe(false);
    expect(result.detected).toEqual([{ detector: 'no_fnr', confidence: 'high', count: 1 }]);
  });

  it('reports detectors the org has not enabled, so an operator can discover them', () => {
    const result = applyInboundRedaction({ body: `${NO_SYNTHETIC} og 010190-1234` }, REMOVE_NO);
    expect(result.detected).toEqual([
      { detector: 'no_fnr', confidence: 'high', count: 1 },
      { detector: 'dk_cpr', confidence: 'high', count: 1 },
    ]);
    expect(result.fields.body).toBe('[fødselsnummer fjernet] og 010190-1234');
  });

  it('scrubs every persisted copy, not just the body', () => {
    const result = applyInboundRedaction(
      {
        body: `body ${NO_SYNTHETIC}`,
        bodyHtml: `<p>html ${NO_SYNTHETIC}</p>`,
        subject: `subject ${NO_SYNTHETIC}`,
        metadata: {
          preStripBody: `pre ${NO_SYNTHETIC}`,
          signatureText: `sig ${NO_SYNTHETIC}`,
          raw: `raw ${NO_SYNTHETIC}`,
          quotedThread: [{ from: 'a', body: `quoted ${NO_SYNTHETIC}`, subject: `s ${NO_SYNTHETIC}` }],
          inboundMessageId: 'keep-me',
        },
      },
      REMOVE_NO,
    );

    const serialized = JSON.stringify(result.fields);
    expect(serialized).not.toContain('01819012365');
    expect(serialized).not.toContain('018190');
    expect(result.fields.metadata?.inboundMessageId).toBe('keep-me');
    expect((result.fields.metadata?.quotedThread as { body: string }[])[0]!.body).toBe(
      'quoted [fødselsnummer fjernet]',
    );
  });

  it('leaves the original object untouched', () => {
    const fields = { body: `fnr ${NO_SYNTHETIC}`, metadata: { preStripBody: NO_SYNTHETIC } };
    applyInboundRedaction(fields, REMOVE_NO);
    expect(fields.body).toBe(`fnr ${NO_SYNTHETIC}`);
    expect(fields.metadata.preStripBody).toBe(NO_SYNTHETIC);
  });

  it('masks to the birth date when the policy asks for masking', () => {
    const result = applyInboundRedaction({ body: NO_SYNTHETIC }, { ...REMOVE_NO, policy: 'mask' });
    expect(result.fields.body).toBe('018190*****');
  });

  it('honours a medium floor by also catching the separator-less forms', () => {
    const lenient = {
      detectors: ['dk_cpr'] as const,
      policy: 'remove' as const,
      minConfidence: 'medium' as const,
    };
    expect(applyInboundRedaction({ body: '0101901234' }, lenient).fields.body).toBe(
      '[CPR-nummer fjernet]',
    );
    expect(
      applyInboundRedaction({ body: '0101901234' }, { ...lenient, minConfidence: 'high' }).fields
        .body,
    ).toBe('0101901234');
  });
});

describe('parseRedactionPolicy', () => {
  it('is off for an org that never configured anything', () => {
    expect(parseRedactionPolicy({})).toEqual(REDACTION_OFF);
  });

  it('reads a configured policy', () => {
    const parsed = parseRedactionPolicy({
      [REDACTION_SETTINGS_KEY]: {
        detectors: ['no_fnr', 'dk_cpr'],
        policy: 'mask',
        minConfidence: 'medium',
      },
    });
    expect(parsed).toEqual({
      detectors: ['no_fnr', 'dk_cpr'],
      policy: 'mask',
      minConfidence: 'medium',
    });
  });

  it('drops unknown detectors rather than failing the ingest', () => {
    const parsed = parseRedactionPolicy({
      [REDACTION_SETTINGS_KEY]: { detectors: ['no_fnr', 'fi_hetu'], policy: 'remove' },
    });
    expect(parsed.detectors).toEqual(['no_fnr']);
  });

  it('falls back to off for an unrecognised policy value', () => {
    const parsed = parseRedactionPolicy({
      [REDACTION_SETTINGS_KEY]: { detectors: ['no_fnr'], policy: 'destroy' },
    });
    expect(parsed.policy).toBe('off');
  });

  it('ignores a malformed settings value', () => {
    expect(parseRedactionPolicy({ [REDACTION_SETTINGS_KEY]: 'yes' })).toEqual(REDACTION_OFF);
  });
});

describe('isRedactionConfigured', () => {
  it('is false for an org that never saved a policy', () => {
    expect(isRedactionConfigured({})).toBe(false);
  });

  it('counts an explicit off as a decision', () => {
    expect(
      isRedactionConfigured({
        [REDACTION_SETTINGS_KEY]: { detectors: [], policy: 'off', minConfidence: 'high' },
      }),
    ).toBe(true);
  });

  it('does not count a malformed settings value as a decision', () => {
    expect(isRedactionConfigured({ [REDACTION_SETTINGS_KEY]: 'yes' })).toBe(false);
  });
});
